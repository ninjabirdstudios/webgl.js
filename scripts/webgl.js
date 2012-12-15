/*/////////////////////////////////////////////////////////////////////////////
/// @summary Implements a set of routines for working with WebGL resources at a
/// low level, including basic low-level optimizations like preventing
/// redundant render state changes.
/// @author Russell Klenk (russ@ninjabirdstudios.com)
///////////////////////////////////////////////////////////////////////////80*/
var WebGL = (function (exports)
{
    /// Defines some constant values used to distinguish between shader types
    /// without relying on having a valid WebGLRenderingContext object. These
    /// types are passed to the errorFunc callback of webglBuildProgram().
    const build_stage   = {
        /// Specifies that the error occurred while compiling a vertex shader, and
        /// the source_code field specifies the vertex shader source code.
        COMPILE_VS      : 0,
        /// Specifies that the error occurred while compiling a fragment shader,
        /// and the source_code field specifies the fragment shader source code.
        COMPILE_FS      : 1,
        /// Specifies that the error occurred during the program linking stage.
        LINK_PROGRAM    : 2,
    };

    /// An array specifying the names of the texture slots that can be passed to
    /// gl.activeTexture(). This table is used during uniform binding.
    const texture_slots = [
        'TEXTURE0',  'TEXTURE1',  'TEXTURE2',  'TEXTURE3',  'TEXTURE4',
        'TEXTURE5',  'TEXTURE6',  'TEXTURE7',  'TEXTURE8',  'TEXTURE9',
        'TEXTURE10', 'TEXTURE11', 'TEXTURE12', 'TEXTURE13', 'TEXTURE14',
        'TEXTURE15', 'TEXTURE16', 'TEXTURE17', 'TEXTURE18', 'TEXTURE19',
        'TEXTURE20', 'TEXTURE21', 'TEXTURE22', 'TEXTURE23', 'TEXTURE24',
        'TEXTURE25', 'TEXTURE26', 'TEXTURE27', 'TEXTURE28', 'TEXTURE29',
        'TEXTURE30', 'TEXTURE31'
    ];

    /// An array specifying all of the valid GLSL ES 1.0 type names. This table is
    /// used during uniform binding.
    const type_names    = {
        BOOL            : 'bool',
        INT             : 'int',
        FLOAT           : 'float',
        VEC2            : 'vec2',
        VEC3            : 'vec3',
        VEC4            : 'vec4',
        BVEC2           : 'bvec2',
        BVEC3           : 'bvec3',
        BVEC4           : 'bvec4',
        IVEC2           : 'ivec2',
        IVEC3           : 'ivec3',
        IVEC4           : 'ivec4',
        MAT2            : 'mat2',
        MAT3            : 'mat3',
        MAT4            : 'mat4',
        SAMPLER_2D      : 'sampler2D',
        SAMPLER_CUBE    : 'samplerCube'
    };

    /// Constructor function for the core Emitter type, which provides a
    /// simple node.js-style EventEmitter implementation.
    var Emitter = function ()
    {
        /* empty */
    };

    /// Registers an event listener for a particular named event type.
    /// @param event A string specifying the name of the event to listen for.
    /// @param callback A function to invoke when the event is emitted.
    /// @return A reference to the calling context.
    Emitter.prototype.on = function (event, callback)
    {
        var  listeners   = this.listeners   || {};
        var  handler     = listeners[event] || []; handler.push(callback);
        this.listeners   = this.listeners   || listeners;
        listeners[event] = handler;
        return this;
    };

    /// Registers an event listener to be called once for a named event.
    /// @param event A string specifying the name of the event to listen for.
    /// @param callback A function to invoke when the event is emitted.
    /// @return A reference to the calling context.
    Emitter.prototype.once = function (event, callback)
    {
        var self = this;
        var func = function ()
            {
                self.removeListener(event, func);
                callback.apply(this, arguments);
            };
        func.callback = callback;
        return self.on(event, func);
    };

    /// Registers an event listener for a particular named event type.
    /// @param event A string specifying the name of the event to listen for.
    /// @param callback A function to invoke when the event is emitted.
    /// @return A reference to the calling context.
    Emitter.prototype.addListener = Emitter.prototype.on; // alias

    /// Removes a registered event listener for a particular named event type.
    /// @param event A string specifying the name of the event.
    /// @param callback The callback function registered to listen for @a event
    /// and identifying which listener to remove.
    /// @return A reference to the calling context.
    Emitter.prototype.removeListener = function (event, callback)
    {
        var  listeners   = this.listeners   || {};
        var  handler     = listeners[event] || [];
        this.listeners   = this.listeners   || listeners;
        handler.splice(handler.indexOf(callback), 1);
        listeners[event] = handler;
        return this;
    };

    /// Removes all registered event listeners for a particular event type.
    /// @param event A string specifying the name of the event.
    /// @return A reference to the calling context.
    Emitter.prototype.removeAllListeners = function (event)
    {
        var  listeners   = this.listeners || {};
        this.listeners   = this.listeners || listeners;
        listeners[event] = null;
        return this;
    };

    /// Emits a named event, immediately invoking all registered listeners. Any
    /// additional arguments aside from @a event are passed to the listeners.
    /// @param event A string specifying the name of the event being raised.
    /// @return A reference to the calling context.
    Emitter.prototype.emit = function (event)
    {
        var  listeners = this.listeners || {};
        this.listeners = this.listeners || listeners;
        var  listener  = this.listeners[event];
        if  (listener)
        {
            var count  = arguments.length;
            var n      = listener.length;
            var i      = 0;
            switch (count)
            {
                case 1:
                    for (i = 0; i < n; ++i)
                        listener[i].call(this);
                    break;
                case 2:
                    for (i = 0; i < n; ++i)
                        listener[i].call(this, arguments[1]);
                    break;
                case 3:
                    for (i = 0; i < n; ++i)
                        listener[i].call(this, arguments[1], arguments[2]);
                    break;
                default:
                    var args = Array.prototype.slice.call(arguments, 1);
                    for (i   = 0; i < n; ++i)
                        listener[i].apply(this, args);
                    break;
            }
        }
        return this;
    };

    /// Adds the methods of the Emitter object to a specific instance of an
    /// existing object. This is different from the inherits() function, which
    /// adds the Emitter methods to the object prototype.
    /// @param target The target object instance.
    /// @return A reference to @a target.
    Emitter.extend = function (target)
    {
        target                    = target || {};
        target.on                 = Emitter.prototype.on;
        target.once               = Emitter.prototype.once;
        target.emit               = Emitter.prototype.emit;
        target.addListener        = Emitter.prototype.addListener;
        target.removeListener     = Emitter.prototype.removeListener;
        target.removeAllListeners = Emitter.prototype.removeAllListeners;
        return target;
    };

    /// A handy utility function that prevents having to write the same
    /// obnoxious code everytime. The typical javascript '||' trick works for
    /// strings, arrays and objects, but it doesn't work for booleans or
    /// integer values.
    /// @param value The value to test.
    /// @param theDefault The value to return if @a value is undefined.
    /// @return Either @a value or @a theDefault (if @a value is undefined.)
    function defaultValue(value, theDefault)
    {
        return (value !== undefined) ? value : theDefault;
    }

    /// Define a utility function to perform prototype inheritence, such that a
    /// child type inherits the fields and methods of a parent type.
    /// @param childCtor The constructor function for the child type.
    /// @param parentCtor The constructor function for the parent type.
    function inherits(childCtor, parentCtor)
    {
        childCtor.supertype = parentCtor;
        childCtor.prototype = Object.create(
            parentCtor.prototype, {
                constructor : {
                    value         : childCtor,
                    enumerable    : false,
                    writable      : true,
                    configurable  : true
                }
            });
    }

    /// Constructor function for the GLContext type. The GLContext manages
    /// global render state and all resource managemen and data upload.
    /// @param gl The WebGLRenderingContext object.
    /// @param canvas The DOM Canvas element used to create context @a gl.
    function GLContext = function (gl, canvas)
    {
        if (!(this instanceof GLContext))
        {
            return new GLContext(gl);
        }
        this.gl                      = gl;
        this.canvas                  = canvas;
        this.activeTextures          = new Array(32);
        this.activeTextureIndex      = 0;
        this.activeProgram           = null;
        this.activeArrayBuffer       = null;
        this.activeElementBuffer     = null;
        this.activeViewport          = this.createViewport(canvas);
        this.activeBlendState        = this.createBlendState();
        this.activeDepthStencilState = this.createDepthStencilState();
        this.activeRasterState       = this.createRasterState();
        this.defaultViewport         = this.createViewport(canvas);
        // @todo: extension querying
        return this;
    };  inherits(GLContext, Emitter);

    /// Creates an object specifying the properties of the viewport.
    /// @param canvas An optional reference to the DOM Canvas element used to
    /// create the render context. If specified, the Canvas width and height
    /// are used as the viewport width and height.
    /// @return An object specifying the viewport properties.
    /// obj.x The x-coordinate of the upper-left corner of the viewport.
    /// obj.y The y-coordinate of the upper-left corner of the viewport.
    /// obj.width The width of the viewport, in pixels.
    /// obj.height The height of the viewport, in pixels.
    /// obj.near The distance to the near clipping plane.
    /// obj.far The distance to the far clipping plane.
    GLContext.prototype.createViewport = function (canvas)
    {
        var width  = 1;
        var height = 1;
        if (canvas)
        {
            width  = canvas.width;
            height = canvas.height;
        }
        return {
            x      : 0,
            y      : 0,
            width  : width,
            height : height,
            near   : 0.0,
            far    : 1.0
        };
    };

    /// Applies a viewport configuration.
    /// @param viewport A viewport object as returned by the function
    /// @a GLContext.createViewport().
    /// @return The GLContext.
    GLContext.prototype.applyViewport = function (viewport)
    {
        var gl      = this.gl;
        var current = this.activeViewport;
        var n_x     = viewport.x;
        var n_y     = viewport.y;
        var n_w     = viewport.width;
        var n_h     = viewport.height;
        var n_n     = viewport.near;
        var n_f     = viewport.far;
        if (current.x     !== n_x || current.y      !== n_y ||
            current.width !== n_w || current.height !== n_h)
        {
            gl.viewport(n_x, n_y, n_w, n_h);
            current.x      = n_x;
            current.y      = n_y;
            current.width  = n_w;
            current.height = n_h;
        }
        if (current.near !== n_n || current.far !== n_f)
        {
            gl.depthRange(n_n, n_f);
            current.near   = n_n;
            current.far    = n_f;
        }
        return this;
    };

    /// Creates a mutable blend state object.
    /// @param args An object specifying initial state values. This object has
    /// the same set of fields as the object returned by the function. Any
    /// unspecified values are set to the default.
    /// @return An object representing the default blending state.
    /// obj.enabled A boolean value indicating whether blending is enabled.
    /// obj.constantColorRGBA A 4-element array of floats for specifying a
    /// constant blending color.
    /// obj.sourceFactorRGB One of the WebGL BlendingFactorSrc values.
    /// obj.sourceFactorAlpha One of the WebGL BlendingFactorSrc values.
    /// obj.targetFactorRGB One of the WebGL BlendingFactorDest values.
    /// obj.targetFactorAlpha One of the WebGL BlendingFactorDest values.
    /// obj.functionRGB One of the WebGL Separate Blend Function values.
    /// obj.functionAlpha One of the WebGL Separate Blend Function values.
    GLContext.prototype.createBlendState = function (args)
    {
        var gl = this.gl;
        var DV = defaultValue;
        args   = args || {};
        return {
            enabled           : DV(args.enabled,           false),
            constantColorRGBA : DV(args.constantColorRGBA, [0.0,0.0,0.0,0.0]),
            sourceFactorRGB   : DV(args.sourceFactorRGB,   gl.ONE),
            sourceFactorAlpha : DV(args.sourceFactorAlpha, gl.ONE),
            targetFactorRGB   : DV(args.targetFactorRGB,   gl.ZERO),
            targetFactorAlpha : DV(args.targetFactorAlpha, gl.ZERO),
            functionRGB       : DV(args.functionRGB,       gl.FUNC_ADD),
            functionAlpha     : DV(args.functionAlpha,     gl.FUNC_ADD)
        };
    };

    /// Applies a blending state configuration.
    /// @param newState A blend state object as returned by the function
    /// @a GLContext.createBlendState().
    /// @return The GLContext.
    GLContext.prototype.applyBlendState = function (newState)
    {
        var gl              = this.gl;
        var n_enabled       = newState.enabled;
        var n_func_rgb      = newState.functionRGB;
        var n_func_alpha    = newState.functionAlpha;
        var n_src_rgb       = newState.sourceFactorRGB;
        var n_src_alpha     = newState.sourceFactorAlpha;
        var n_dst_rgb       = newState.targetFactorRGB;
        var n_dst_alpha     = newState.targetFactorAlpha;
        var state           = this.activeBlendState;
        if (state.enabled !== newState.enabled)
        {
            if (n_enabled)  gl.enable (gl.BLEND);
            else            gl.disable(gl.BLEND);
            state.enabled = n_enabled;
        }
        if (state.functionRGB   !== n_func_rgb ||
            state.functionAlpha !== n_func_alpha)
        {
            gl.blendEquationSeparate(n_func_rgb, n_func_alpha);
            state.functionRGB   = n_func_rgb;
            state.functionAlpha = n_func_alpha;
        }
        if (state.sourceFactorRGB   !== n_src_rgb   ||
            state.sourceFactorAlpha !== n_src_alpha ||
            state.targetFactorRGB   !== n_dst_rgb   ||
            state.targetFactorAlpha !== n_dst_alpha)
        {
            gl.blendFuncSeparate(n_src_rgb, n_dst_rgb, n_src_alpha, n_dst_alpha);
            state.sourceFactorRGB   = n_src_rgb;
            state.sourceFactorAlpha = n_src_alpha;
            state.targetFactorRGB   = n_dst_rgb;
            state.targetFactorAlpha = n_dst_alpha;
        }
        var curColor =    state.constantColorRGBA;
        var newColor = newState.constantColorRGBA;
        if (curColor[0] !== newColor[0] ||
            curColor[1] !== newColor[1] ||
            curColor[2] !== newColor[2] ||
            curColor[3] !== newColor[3])
        {
            gl.blendColor(newColor[0], newColor[1], newColor[2], newColor[3]);
            curColor[0] = newColor[0];
            curColor[1] = newColor[1];
            curColor[2] = newColor[2];
            curColor[3] = newColor[3];
        }
        return this;
    };

    /// Creates a mutable state object representing state for the depth and
    /// stencil buffers.
    /// @param args An object specifying initial state values. This object has
    /// the same set of fields as the object returned by the function. Any
    /// unspecified values are set to the default.
    /// @return An object representing the default depth-stencil state.
    /// obj.depthWriteEnabled A boolean value, true if enabled.
    /// obj.depthTestEnabled A boolean value, true if enabled.
    /// obj.depthTestFunction One of the StencilFunction values.
    /// obj.stencilTestEnabled A boolean value, true if enabled.
    /// obj.stencilMaskBack A 32-bit unsigned integer value specifying the
    /// stencil mask for back-facing triangles.
    /// obj.stencilReferenceBack An 8-bit unsigned integer value specifying the
    /// reference value for back-facing triangles during the stencil test.
    /// obj.stencilFunctionBack One of the StencilFunction values.
    /// obj.stencilFailOpBack One of the StencilOp values.
    /// obj.stencilPassOpZFailBack One of the StencilOp values.
    /// obj.stencilPassOpZPassBack One of the StencilOp values.
    /// obj.stencilMaskFront A 32-bit unsigned integer value specifying the
    /// stencil mask for front-facing triangles.
    /// obj.stencilReferenceFront An 8-bit unsigned integer value specifying
    /// the reference value for front-facing triangles during the stencil test.
    /// obj.stencilFunctionFront One of the StencilFunction values.
    /// obj.stencilFailOpFront One of the StencilOp values.
    /// obj.stencilPassOpZFailFront One of the StencilOp values.
    /// obj.stencilPassOpZPassFront One of the StencilOp values.
    GLContext.prototype.createDepthStencilState = function (args)
    {
        var gl = this.gl;
        var DV = defaultValue;
        args   = args || {};
        return {
            depthWriteEnabled       : DV(args.depthWriteEnabled,       true),
            depthTestEnabled        : DV(args.depthTestEnabled,        false),
            depthTestFunction       : DV(args.depthTestFunction,       gl.LESS),
            stencilTestEnabled      : DV(args.stencilTestEnabled,      false),
            stencilMaskBack         : DV(args.stenciMaskBack,          0xFFFFFFFF),
            stencilReferenceBack    : DV(args.stencilReferenceBack,    0),
            stencilFunctionBack     : DV(args.stencilFunctionBack,     gl.ALWAYS),
            stencilFailOpBack       : DV(args.stencilFailOpBack,       gl.KEEP),
            stencilPassOpZFailBack  : DV(args.stencilPassOpZFailBack,  gl.KEEP),
            stencilPassOpZPassBack  : DV(args.stencilPassOpZPassBack,  gl.KEEP),
            stencilMaskFront        : DV(args.stencilMaskFront,        0xFFFFFFFF),
            stencilReferenceFront   : DV(args.stencilReferenceFront,   0),
            stencilFunctionFront    : DV(args.stencilFunctionFront,    gl.ALWAYS),
            stencilFailOpFront      : DV(args.stencilFailOpFront,      gl.KEEP),
            stencilPassZFailOpFront : DV(args.stencilPassZFailOpFront, gl.KEEP),
            stencilPassZPassOpFront : DV(args.stencilPassZPassOpFront, gl.KEEP)
        };
    };

    /// Applies new stencil mask values.
    /// @param front The stencil mask to apply for front-facing triangles.
    /// @param back The stencil mask to apply for back-facing triangles.
    /// @return The GLContext.
    GLContext.prototype.applyStencilMask = function (front, back)
    {
        var gl      = this.gl;
        var state   = this.activeDepthStencilState;
        if (front !== undefined && back === undefined)
            back    = front;
        if (state.stencilMaskBack !== back)
        {
            gl.stencilMaskSeparate(gl.BACK, back);
            state.stencilMaskBack   = back;
        }
        if (state.stencilMaskFront !== front)
        {
            gl.stencilMaskSeparate(gl.FRONT, front);
            state.stencilMaskFront  = front;
        }
        return this;
    };

    /// Applies a depth and stencil buffer state configuration.
    /// @param newState A state object as returned by the function
    /// @a GLContext.createDepthStencilState().
    /// @return The GLContext.
    GLContext.prototype.applyDepthStencilState = function (newState)
    {
        var gl          = this.gl;
        var n_d_writes  = newState.depthWriteEnabled;
        var n_d_test    = newState.depthTestEnabled;
        var n_d_func    = newState.depthTestFunction;
        var n_s_test    = newState.stencilTestEnabled;
        var n_s_ref_b   = newState.stencilReferenceBack;
        var n_s_mask_b  = newState.stencilMaskBack;
        var n_s_func_b  = newState.stencilFunctionBack;
        var n_s_op_ff_b = newState.stencilFailOpBack;
        var n_s_op_pf_b = newState.stencilPassOpZFailBack;
        var n_s_op_pp_b = newState.stencilPassOpZPassBack;
        var n_s_ref_f   = newState.stencilReferenceFront;
        var n_s_mask_f  = newState.stencilMaskFront;
        var n_s_func_f  = newState.stencilFunctionFront;
        var n_s_op_ff_f = newState.stencilFailOpFront;
        var n_s_op_pf_f = newState.stencilPassOpZFailFront;
        var n_s_op_pp_f = newState.stencilPassOpZPassFront;
        var state       = this.activeDepthStencilState;

        // depth buffer states.
        if (state.depthWriteEnabled !== n_d_writes)
        {
            gl.depthMask(n_d_writes);
            state.depthWriteEnabled = n_d_writes;
        }
        if (state.depthTestEnabled !== n_d_test)
        {
            if (n_d_test) gl.enable (gl.DEPTH_TEST);
            else          gl.disable(gl.DEPTH_TEST);
            state.depthTestEnable  = n_d_test;
        }
        if (state.depthTestFunction !== n_d_func)
        {
            gl.depthFunc(n_d_func);
            state.depthTestFunction = n_d_func;
        }

        // stencil buffer states (general).
        if (state.stencilTestEnabled !== n_s_test)
        {
            if (n_s_test) gl.enable (gl.STENCIL_TEST);
            else          gl.disable(gl.STENCIL_TEST);
            state.stencilTestEnabled = n_s_test;
        }

        // stencil buffer states (back).
        if (state.stencilMaskBack      !== n_s_mask_b ||
            state.stencilReferenceBack !== n_s_ref_b  ||
            state.stencilFunctionBack  !== n_s_func_b)
        {
            gl.stencilFuncSeparate(gl.BACK, n_s_func_b, n_s_ref_b, n_s_mask_b);
            state.stencilMaskBack        = n_s_mask_b;
            state.stencilReferenceBack   = n_s_ref_b;
            state.stencilFunctionBack    = n_s_func_b;
        }
        if (state.stencilFailOpBack      !== n_s_op_ff_b ||
            state.stencilPassOpZFailBack !== n_s_op_pf_b ||
            state.stencilPassOpZPassBack !== n_s_op_pp_b)
        {
            gl.stencilOpSeparate(gl.BACK, n_s_op_ff_b, n_s_op_pf_b, n_s_op_pp_b);
            state.stencilFailOpBack      = n_s_op_ff_b;
            state.stencilPassOpZFailBack = n_s_op_pf_b;
            state.stencilPassOpZPassBack = n_s_op_pp_b;
        }

        // stencil buffer states (front).
        if (state.stencilMaskFront      !== n_s_mask_f ||
            state.stencilReferenceFront !== n_s_ref_f  ||
            state.stencilFunctionFront  !== n_s_func_f)
        {
            gl.stencilFuncSeparate(gl.FRONT, n_s_func_f, n_s_ref_f, n_s_mask_f);
            state.stencilMaskFront        = n_s_mask_f;
            state.stencilReferenceFront   = n_s_ref_f;
            state.stencilFunctionFront    = n_s_func_f;
        }
        if (state.stencilFailOpFront      !== n_s_op_ff_f ||
            state.stencilPassOpZFailFront !== n_s_op_pf_f ||
            state.stencilPassOpZPassFront !== n_s_op_pp_f)
        {
            gl.stencilOpSeparate(gl.FRONT, n_s_op_ff_f, n_s_op_pf_f, n_s_op_pp_f);
            state.stencilFailOpBFront      = n_s_op_ff_f;
            state.stencilPassOpZFailBFront = n_s_op_pf_f;
            state.stencilPassOpZPassBFront = n_s_op_pp_f;
        }
        return this;
    };

    /// Creates a mutable state object representing rasterizer state.
    /// For information on the offsetFactor and offsetUnits fields, see:
    /// http://www.opengl.org/archives/resources/faq/technical/polygonoffset.htm
    /// For information on the invertCoverage and converageValue fields, see:
    /// http://www.khronos.org/opengles/sdk/1.1/docs/man/glSampleCoverage.xml
    /// @param args An object specifying initial state values. This object has
    /// the same set of fields as the object returned by the function. Any
    /// unspecified values are set to the default.
    /// @return An object representing the default rasterizer state.
    /// obj.colorWriteRGBA An array of four boolean values indicating whether
    /// the color buffer will be updated for each respective channel.
    /// obj.cullingEnabled true to enable back-face culling.
    /// obj.cullFace One of the CullFaceMode values.
    /// obj.windingOrder One of the FrontFaceDirection values.
    /// obj.scissorTestEnabled true to enable scissor testing.
    /// obj.scissorX The x-coord of the upper-left corner of the scissor rect.
    /// obj.scissorY The y-coord of the upper-left corner of the scissor rect.
    /// obj.scissorWidth The width of the scissor rectangle.
    /// obj.scissorHeight The height of the scissor rectangle.
    /// obj.lineWidth The width to use when rendering antialised lines.
    /// obj.offsetFactor The polygon offset factor. See comment above.
    /// obj.offsetUnits The polygon offset units. See comment above.
    /// obj.sampleCoverageEnabled true to enable sample coverage.
    /// obj.sampleAlphaToCoverage true to enable sample alpha-to-coverage.
    /// obj.invertCoverage true to invert sample coverage. See comment above.
    /// obj.coverageValue The alpha coverage value. See comment above.
    GLContext.prototype.createRasterState = function (args)
    {
        var gl = this.gl;
        var DV = defaultValue;
        args   = args || {};
        return {
            colorWriteRGBA        : DV(args.colorWriteRGBA,  [true, true, true, true]),
            cullingEnabled        : DV(args.cullingEnabled,         false),
            cullFace              : DV(args.cullFace,               gl.BACK),
            windingOrder          : DV(args.windingOrder,           gl.CCW),
            scissorTestEnabled    : DV(args.scissorTestEnabled,     false),
            scissorX              : DV(args.scissorX,               0),
            scissorY              : DV(args.scissorY,               0),
            scissorWidth          : DV(args.scissorWidth,           0),
            scissorHeight         : DV(args.scissorHeight,          0),
            lineWidth             : DV(args.lineWidth,              1.0),
            offsetFactor          : DV(args.offsetFactor,           0.0),
            offsetUnits           : DV(args.offsetUnits,            0.0),
            sampleCoverageEnabled : DV(args.sampleCoverageEnabled,  false),
            sampleAlphaToCoverage : DV(args.sampleAlphaToCoverage,  false),
            invertCoverage        : DV(args.invertCoverage,         false),
            coverageValue         : DV(args.coverageValue,          1.0)
        };
    };

    /// Applies a raster state configuration.
    /// @param newState A state object as returned by the function
    /// @a GLContext.createRasterState().
    /// @return The GLContext.
    GLContext.prototype.applyRasterState = function (newState)
    {
        var gl          = this.gl;
        var n_culling   = newState.cullingEnabled;
        var n_cullface  = newState.cullFace;
        var n_winding   = newState.windingOrder;
        var n_scissor   = newState.scissorTestEnabled;
        var n_scissor_x = newState.scissorX;
        var n_scissor_y = newState.scissorY;
        var n_scissor_w = newState.scissorWidth;
        var n_scissor_h = newState.scissorHeight;
        var n_po_f      = newState.offsetFactor;
        var n_po_u      = newState.offsetUnits;
        var n_sc        = newState.sampleCoverageEnabled;
        var n_sac       = newState.sampleAlphaToCoverage;
        var n_inv_c     = newState.invertCoverage;
        var n_cv        = newState.converageValue;
        var n_width     = newState.lineWidth;
        var state       = this.activeRasterState;

        // states related to back-face culling.
        if (state.cullingEnabled !== n_culling)
        {
            if (n_culling) gl.enable (gl.CULL_FACE);
            else           gl.disable(gl.CULL_FACE);
            state.cullingEnabled = n_culling;
        }
        if (state.cullFace !== n_cullface)
        {
            gl.cullFace(n_cullface);
            state.cullFace = n_cullface;
        }
        if (state.windingOrder !== n_winding)
        {
            gl.frontFace(n_winding);
            state.windingOrder = n_winding;
        }

        // states related to scissor testing.
        if (state.scissorTestEnabled !== n_scissor)
        {
            if (n_scissor) gl.enable (gl.SCISSOR_TEST);
            else           gl.disable(gl.SCISSOR_TEST);
            state.scissorTestEnabled = n_scissor;
        }
        if (state.scissorX      !== n_scissor_x ||
            state.scissorY      !== n_scissor_y ||
            state.scissorWidth  !== n_scissor_w ||
            state.scissorHeight !== n_scissor_h)
        {
            gl.scissor(n_scissor_x, n_scissor_y, n_scissor_w, n_scissor_h);
            state.scissorX      = n_scissor_x;
            state.scissorY      = n_scissor_y;
            state.scissorWidth  = n_scissor_w;
            state.scissorHeight = n_scissor_h;
        }

        // states related to polygon offset.
        if (state.offsetFactor !== n_po_f || state.offsetUnits !== n_po_u)
        {
            gl.polygonOffset(n_po_f, n_po_u);
            state.offsetFactor = n_po_f;
            state.offsetUnits  = n_po_u;
        }

        // states related to multisample coverage.
        if (state.sampleCoverageEnabled !== n_sc)
        {
            if (n_sc)  gl.enable (gl.SAMPLE_COVERAGE);
            else       gl.disable(gl.SAMPLE_COVERAGE);
            state.sampleCoverageEnabled = n_sc;
        }
        if (state.sampleAlphaToCoverage !== n_sac)
        {
            if (n_sac) gl.enable (gl.SAMPLE_ALPHA_TO_COVERAGE);
            else       gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
            state.sampleAlphaToCoverage = n_sac;
        }
        if (state.invertCoverage !== n_inv_c || state.coverageValue !== n_cv)
        {
            gl.sampleCoverage(n_cv, n_inv_c);
            state.invertCoverage =  n_inv_c;
            state.coverageValue  =  n_cv;
        }

        // states related to antialiased line width.
        if (state.lineWidth !== n_width)
        {
            gl.lineWidth(n_width);
            state.lineWidth = n_width;
        }

        // states related to color buffer write masks.
        var n_write_r = newState.colorWriteRGBA[0];
        var n_write_g = newState.colorWriteRGBA[1];
        var n_write_b = newState.colorWriteRGBA[2];
        var n_write_a = newState.colorWriteRGBA[3];
        if (state.colorWriteRGBA[0] !== n_write_r ||
            state.colorWriteRGBA[1] !== n_write_g ||
            state.colorWriteRGBA[2] !== n_write_b ||
            state.colorWriteRGBA[3] !== n_write_a)
        {
            gl.colorMask(n_write_r, n_write_g, n_write_b, n_write_a);
            state.colorWriteRGBA[0] = n_write_r;
            state.colorWriteRGBA[1] = n_write_g;
            state.colorWriteRGBA[2] = n_write_b;
            state.colorWriteRGBA[3] = n_write_a;
        }
        return this;
    };

    /// Sets the active scissor rectangle.
    /// @param x The x-coordinate of the upper-left corner.
    /// @param y The y-coordinate of the upper-left corner.
    /// @param width The width of the scissor region.
    /// @param height The height of the scissor region.
    GLContext.prototype.applyScissorRegion = function (x, y, width, height)
    {
        var gl    = this.gl;
        var state = this.activeRasterState;
        if (state.scissorX      !== x     ||
            state.scissorY      !== y     ||
            state.scissorWidth  !== width ||
            state.scissorHeight !== height)
        {
            gl.scissor(x, y, width, height);
            state.scissorX      = x;
            state.scissorY      = y;
            state.scissorWidth  = width;
            state.scissorHeight = height;
        }
        return this;
    };

    /// Enables or disables writes to the color and depth buffers.
    /// @param color A boolean value specifying whether writes to the color
    /// buffer are enabled. This value is applied to all color channels.
    /// @param depth A boolean value specifying whether writes to the depth
    /// buffer are enabled.
    /// @return The GLContext.
    GLContext.prototype.applyWriteMasks = function (color, depth)
    {
        var gl    = this.gl;
        var state = this.activeRasterState;
        if (state.colorWriteRGBA[0] !== color ||
            state.colorWriteRGBA[1] !== color ||
            state.colorWriteRGBA[2] !== color ||
            state.colorWriteRGBA[3] !== color)
        {
            gl.colorMask(color, color, color, color);
            state.colorWriteRGBA[0]  = color;
            state.colorWriteRGBA[1]  = color;
            state.colorWriteRGBA[2]  = color;
            state.colorWriteRGBA[3]  = color;
        }
        if (this.activeDepthStencilState.depthWriteEnabled !== depth)
        {
            gl.depthMask(depth);
            this.activeDepthStencilState.depthWriteEnabled = depth;
        }
        return this;
    };

    /// Selects a texture unit as the target of subsequent texture bind
    /// operations and during shader uniform binding of texture samplers.
    /// @param unit The zero-based index of the texture unit to select.
    /// @return The GLContext.
    GLContext.prototype.useTextureUnit = function (unit)
    {
        var gl = this.gl;
        if (this.activeTextureIndex !== unit)
        {
            gl.activeTexture(gl[texture_slots[unit]]);
            this.activeTextureIndex = unit;
        }
        return this;
    };

    /// Binds a texture to the currently active texture unit.
    /// @param obj The texture object to select for modification or use. See
    /// @a GLContext.createTextureProxy().
    /// @return The GLContext.
    GLContext.prototype.useTexture = function (obj)
    {
        var gl   = this.gl;
        var unit = this.activeTextureIndex;
        if (this.activeTextures[unit] !== obj)
        {
            gl.bindTexture(obj.bindTarget, obj.textureResource);
            this.activeTextures[unit] = obj;
        }
        return this;
    };

    /// Selects a shader program for use in subsequent draw calls.
    /// @param obj The program object to select for modification or use. See
    /// @a GLContext.createProgramProxy().
    /// @return The GLContext.
    GLContext.prototype.useProgram = function (obj)
    {
        if (this.activeProgram !== obj)
        {
            var gl = this.gl;
            gl.useProgram(obj.programResource);
            this.activeProgram = obj;
        }
        return this;
    };

    /// Selects an array buffer or element array buffer for use in subsequent
    /// draw calls.
    /// @param obj The buffer object to select for modification or use. See
    /// @a GLContext.createBufferProxy().
    /// @return The GLContext.
    GLContext.prototype.useBuffer = function (obj)
    {
        var gl = this.gl;
        if (gl.ARRAY_BUFFER        === obj.bindTarget &&
            this.activeArrayBuffer !== obj)
        {
            gl.bindBuffer(gl.ARRAY_BUFFER, obj.bufferResource);
            this.activeArrayBuffer = obj;
        }
        if (gl.ELEMENT_ARRAY_BUFFER  === obj.bindTarget &&
            this.activeElementBuffer !== obj)
        {
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, obj.bufferResource);
            this.activeElementBuffer = obj;
        }
        return this;
    };

    /// Unbinds the active array buffer or element array buffer.
    /// @param target One of gl.ARRAY_BUFFER or gl.ELEMENT_ARRAY_BUFFER.
    /// @return The GLContext.
    GLContext.prototype.unbindBuffer = function (target)
    {
        var gl = this.gl;
        if (gl.ARRAY_BUFFER === target && this.activeArrayBuffer)
        {
            gl.bindBuffer(gl.ARRAY_BUFFER, null);
            this.activeArrayBuffer = null;
            return this;
        }
        if (gl.ELEMENT_ARRAY_BUFFER === target && this.activeElementBuffer)
        {
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
            this.activeElementBuffer = null;
            return this;
        }
        return this;
    };

    /// Unbinds the active shader program.
    /// @return The GLContext.
    GLContext.prototype.unbindProgram = function ()
    {
        if (this.activeProgram !== null)
        {
            var gl = this.gl;
            gl.useProgram(null);
            this.activeProgram = null;
        }
        return this;
    };

    /// Unbinds the texture bound to the active texture unit.
    /// @return The GLContext.
    GLContext.prototype.unbindTexture = function (target)
    {
        var unit = this.activeTextureIndex;
        if (this.activeTextures[unit])
        {
            var gl  = this.gl;
            gl.bindTexture(gl.TEXTURE_2D, null);
            gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
            this.activeTextures[unit] = null;
        }
    };

    /// Unbinds all textures from all active texture units.
    /// @return The GLContext.
    GLContext.prototype.unbindAllTextures = function ()
    {
        var gl     = this.gl;
        var t2d    = gl.TEXTURE_2D;
        var tcm    = gl.TEXTURE_CUBE_MAP;
        var slots  = texture_slots;
        var unbind = false;
        for (var i = 0, n = this.activeTextures.length; i < n; ++i)
        {
            if (this.activeTextures[i])
            {
                gl.activeTexture(gl[slots[i]]);
                gl.bindTexture(t2d, null);
                gl.bindTexture(tcm, null);
                this.activeTextures[i] = null;
                unbind = true;
            }
        }
        if (unbind)
        {
            this.activeTextureIndex = 0;
            gl.activeTexture(gl.TEXTURE0);
        }
        if (this.activeProgram)
        {
            // reset state for the active program.
            this.activeProgram.boundTextureCount = 0;
        }
        return this;
    };

    /// Performs a test to determine whether the current runtime environment
    /// supports WebGL; however, just because the runtime environment supports
    /// WebGL does not guarantee that context creation will be successful.
    /// @return true if the runtime environment supports WebGL.
    function isSupported()
    {
        return (window.WebGLRenderingContext ? true : false);
    }

    /// Attempts to create a new WebGL rendering context.
    /// @param canvas The DOM Canvas element to which WebGL will render.
    /// @param attributes A WebGLContextAttributes object. See
    /// https://www.khronos.org/registry/webgl/specs/1.0/#5.2
    /// @return A new instance of GLContext, or undefined if WebGL is not
    /// supported or the context cannot be created (blacklisted driver, etc.)
    function createContext(canvas, attributes)
    {
        var gl    = null;
        var names = [
            'webgl',
            'experimental-webgl',
            'webkit-3d',
            'moz-webgl'
        ];

        // attempt to create the WebGLRenderingContext:
        // https://www.khronos.org/registry/webgl/specs/1.0/#5.13
        // different browsers use different names, so try them all.
        // eventually, we should only have to support 'webgl'.
        for (var i = 0, n = names.length; i < n; ++i)
        {
            try
            {
                gl = canvas.getContext(names[i], attributes);
            }
            catch (error)
            {
                // don't do anything here, we'll try the next name.
            }
            if (gl) return new GLContext(gl, canvas);
        }
    }

    // @todo: contextlost and contextrestored.
    // @todo: createTextureProxy(), createTextureResource(),
    // @todo: deleteTextureProxy(), deleteTextureResource(), etc.

    /// Set the functions exported from this module.
    exports.Emitter       = Emitter;
    exports.inherits      = inherits;
    exports.isSupported   = isSupported;
    exports.createContext = createContext;
    return exports;
}  (WebGL || {}));
