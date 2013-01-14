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
    /// types are passed to the errorFunc callback of GLContext.buildProgram().
    const BuildStage    = {
        /// Specifies that the error occurred while compiling a vertex shader,
        /// and the sourceCode field specifies the vertex shader source code.
        COMPILE_VS      : 0,
        /// Specifies that the error occurred while compiling a fragment shader,
        /// and the sourceCode field specifies the fragment shader source code.
        COMPILE_FS      : 1,
        /// Specifies that the error occurred during the program linking stage.
        LINK_PROGRAM    : 2,
    };

    /// An array specifying the names of the texture slots that can be passed to
    /// gl.activeTexture(). This table is used during uniform binding.
    const TextureSlots  = [
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
    const TypeNames     = {
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
    var GLContext = function (gl, canvas)
    {
        if (!(this instanceof GLContext))
        {
            return new GLContext(gl);
        }
        this.gl                      = gl;
        this.canvas                  = canvas;
        this.activeTextures          = new Array(TextureSlots.length);
        this.activeTextureIndex      = 0;
        this.activeProgram           = null;
        this.activeArrayBuffer       = null;
        this.activeElementBuffer     = null;
        this.activeViewport          = this.createViewport(canvas);
        this.activeBlendState        = this.createBlendState();
        this.activeDepthStencilState = this.createDepthStencilState();
        this.activeRasterState       = this.createRasterState();
        this.defaultViewport         = this.createViewport(canvas);
        // install handlers for context lost/restored events.
        canvas.addEventListener('webglcontextlost',     this.handleContextLost.bind(this),     false);
        canvas.addEventListener('webglcontextrestored', this.handleContextRestored.bind(this), false);
        // @todo: extension querying
        return this;
    };  inherits(GLContext, Emitter);

    /// Handler for the Canvas webglcontextlost event. This handler suppresses
    /// the default behavior which prevents the context from ever being
    /// restored and emits a 'context:lost' event on the GLContext.
    /// @param event The DOM Event object.
    GLContext.prototype.handleContextLost = function (event)
    {
        event.preventDefault();
        this.emit('context:lost', this);
    };

    /// Handler for the Canvas webglcontextrestored event. The handler emits a
    /// 'context:restored' event on the GLContext.
    /// @param event The DOM Event object.
    GLContext.prototype.handleContextRestored = function (event)
    {
        this.emit('context:restored', this);
    };

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
    /// @param proxy The texture object to select for modification or use. See
    /// @a GLContext.createTextureProxy().
    /// @return The GLContext.
    GLContext.prototype.useTexture = function (proxy)
    {
        var gl   = this.gl;
        var unit = this.activeTextureIndex;
        if (this.activeTextures[unit] !== proxy)
        {
            gl.bindTexture(proxy.bindTarget, proxy.textureResource);
            this.activeTextures[unit] = proxy;
        }
        return this;
    };

    /// Selects a shader program for use in subsequent draw calls.
    /// @param proxy The program object to select for modification or use. See
    /// @a GLContext.createProgramProxy().
    /// @return The GLContext.
    GLContext.prototype.useProgram = function (proxy)
    {
        if (this.activeProgram !== proxy)
        {
            var gl = this.gl;
            gl.useProgram(proxy.programResource);
            this.activeProgram = proxy;
        }
        return this;
    };

    /// Selects an array buffer or element array buffer for use in subsequent
    /// draw calls.
    /// @param proxy The buffer object to select for modification or use. See
    /// @a GLContext.createBufferProxy().
    /// @return The GLContext.
    GLContext.prototype.useBuffer = function (proxy)
    {
        var gl = this.gl;
        if (gl.ARRAY_BUFFER        === proxy.bindTarget &&
            this.activeArrayBuffer !== proxy)
        {
            gl.bindBuffer(gl.ARRAY_BUFFER, proxy.bufferResource);
            this.activeArrayBuffer = proxy;
        }
        if (gl.ELEMENT_ARRAY_BUFFER  === proxy.bindTarget &&
            this.activeElementBuffer !== proxy)
        {
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, proxy.bufferResource);
            this.activeElementBuffer = proxy;
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
    GLContext.prototype.unbindTexture = function ()
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

    /// Creates a shader program proxy object, which stores metadata associated
    /// with a paired vertex and fragment shader, as well as the underlying
    /// WebGL resources. This function may be called from any thread.
    /// @return A new shader program proxy object. WebGL resources must be
    /// initialized separately.
    GLContext.prototype.createProgramProxy = function ()
    {
        return {
            id                     : 0,    /* object list id        */
            programResource        : null, /* WebGLProgram instance */
            vertexShaderResource   : null, /* WebGLShader instance  */
            fragmentShaderResource : null, /* WebGLShader instance  */
            webglContext           : this, /* WebGLRenderingContext */
            boundTextureCount      : 0,
            uniformNames           : [],
            uniformTypes           : {},
            uniformLocations       : {},
            attributeNames         : [],
            attributeTypes         : {},
            attributeIndices       : {},
        };
    };

    /// Deletes a shader program proxy object. WebGL resources must be deleted
    /// separately. This function may be called from any thread.
    /// @param proxy The shader program proxy object as returned by the
    /// function @a GLContext.createProgramProxy().
    /// @return The GLContext.
    GLContext.prototype.deleteProgramProxy = function (proxy)
    {
        if (proxy)
        {
            // release references held by the shader program object.
            proxy.programResource        = null;
            proxy.vertexShaderResource   = null;
            proxy.fragmentShaderResource = null;
            proxy.webglContext           = null;
            proxy.uniformNames           = null;
            proxy.uniformTypes           = null;
            proxy.uniformLocations       = null;
            proxy.attributeNames         = null;
            proxy.attributeTypes         = null;
            proxy.attributeIndices       = null;
            proxy.boundTextureCount      = 0;
        }
        return this;
    };

    /// Creates the WebGL resources associated with a shader program by
    /// compiling a vertex shader and fragment shader and linking them into
    /// a complete shader program. This function can only be called from the
    /// main UI thread.
    /// @param proxy The shader program proxy object as returned by the
    /// function @a GLContext.createProgramProxy().
    /// @param vss A string specifying the vertex shader source code.
    /// @param fss A string specifying the fragment shader source code.
    /// @return true if compiling and linking completed successfully.
    GLContext.prototype.createProgramResource = function (proxy, vss, fss)
    {
        if (proxy && proxy.webglContext === this)
        {
            var gl = proxy.webglContext.gl;
            var vs = gl.createShader(gl.VERTEX_SHADER);
            var fs = gl.createShader(gl.FRAGMENT_SHADER);

            // attempt to compile the vertex shader:
            gl.shaderSource (vs, vss);
            gl.compileShader(vs);
            if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS) &&
                !gl.isContextLost())
            {
                var log   = gl.getShaderInfoLog(vs);
                var stage = BuildStage.COMPILE_VS;
                gl.deleteShader(fs);
                gl.deleteShader(vs);
                this.emit('compile:error', this, stage, vss, log);
                return false;
            }

            // attempt to compile the fragment shader:
            gl.shaderSource (fs, fss);
            gl.compileShader(fs);
            if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS) &&
                !gl.isContextLost())
            {
                var log   = gl.getShaderInfoLog(fs);
                var stage = BuildStage.COMPILE_FS;
                gl.deleteShader(fs);
                gl.deleteShader(vs);
                this.emit('compile:error', this, stage, fss, log);
                return false;
            }

            var reflectUniforms = function ()
                {
                    var uMatch = /uniform\s+(\w+)\s+(\w+)\s*;/g
                    var uVert  = vss.match(uMatch);
                    var uFrag  = fss.match(uMatch);
                    if (uVert)
                    {
                        for (var i = 0; i < uVert.length; ++i)
                        {
                            var uniform   = uVert[i].split(uMatch);
                            var uType     = uniform[1];
                            var uName     = uniform[2];
                            proxy.uniformNames.push(uName);
                            proxy.uniformTypes[uName] = uType;
                        }
                    }
                    if (uFrag)
                    {
                        // uniforms from the fragment shader.
                        for (var i = 0; i < uFrag.length; ++i)
                        {
                            var uniform   = uFrag[i].split(uMatch);
                            var uType     = uniform[1];
                            var uName     = uniform[2];
                            proxy.uniformNames.push(uName);
                            proxy.uniformTypes[uName] = uType;
                        }
                    }
                };

            var reflectAttributes = function ()
                {
                    var aMatch = /attribute\s+(\w+)\s+(\w+)\s*;/g
                    var aVert  = vss.match(aMatch);
                    if (aVert)
                    {
                        for (var i = 0; i < aVert.length; ++i)
                        {
                            var attrib    = aVert[i].split(aMatch);
                            var aType     = attrib[1];
                            var aName     = attrib[2];
                            proxy.attributeNames.push(aName);
                            proxy.attributeTypes[aName] = aType;
                        }
                    }
                };

            // create the shader program representing the VS/FS combination.
            var po = gl.createProgram();
            gl.attachShader(po, vs);
            gl.attachShader(po, fs);

            // bind the vertex attribute locations (pre-link.)
            reflectAttributes();
            for (var i = 0; i < proxy.attributeNames.length; ++i)
            {
                var an = proxy.attributeNames[i];
                proxy.attributeIndices[an] =  i;
                gl.bindAttribLocation(po, i, an);
            }

            // link the shader program object.
            gl.linkProgram(po);
            if (!gl.getProgramParameter(po, gl.LINK_STATUS) &&
                !gl.isContextLost())
            {
                var log   = gl.getProgramInfoLog(po);
                var stage = BuildStage.LINK_PROGRAM;
                gl.detachShader (po, fs);
                gl.detachShader (po, vs);
                gl.deleteProgram(po);
                gl.deleteShader (fs);
                gl.deleteShader (vs);
                this.emit('linker:error', this, stage, vss+'\n\n'+fss, log);
                return false;
            }

            // retrieve the bind locations of each uniform (post-link.)
            reflectUniforms();
            for (var i = 0; i < proxy.uniformNames.length; ++i)
            {
                var un = proxy.uniformNames[i];
                proxy.uniformLocations[un] = gl.getUniformLocation(po, un);
            }
            proxy.programResource          = po;
            proxy.vertexShaderResource     = vs;
            proxy.fragmentShaderResource   = fs;
            this.useProgram(proxy);
            return true;
        }
        return false;
    };

    /// Deletes the WebGL resources associated with a shader program. This
    /// function can only be called on the main UI thread.
    /// @param proxy The shader program proxy object as returned by the
    /// function @a GLContext.createProgramProxy().
    /// @return The GLContext.
    GLContext.prototype.deleteProgramResource = function (proxy)
    {
        if (proxy && proxy.webglContext === this)
        {
            if (this.activeProgram === proxy)
                this.unbindProgram();

            var gl = proxy.webglContext.gl;
            gl.detachShader(proxy.programResource, proxy.fragmentShaderResource);
            gl.detachShader(proxy.programResource, proxy.vertexShaderResource);
            gl.deleteShader(proxy.fragmentShaderResource);
            gl.deleteShader(proxy.vertexShaderResource);
            gl.deleteProgram(proxy.programResource);
            proxy.programResource        = null;
            proxy.vertexShaderResource   = null;
            proxy.fragmentShaderResource = null;
        }
        return this;
    };

    /// Sets the value of a uniform variable in the active shader program.
    /// @param name The name of the uniform to set.
    /// @param value The value to set.
    /// @return The GLContext.
    GLContext.prototype.bindUniform = function (name, value)
    {
        if (!this.activeProgram)
            return this;

        var     gl     = this.gl;
        var     glsl   = TypeNames;
        var     shader = this.activeProgram;
        var     bind   = shader.uniformLocations[name];
        var     type   = shader.uniformTypes[name];
        switch (type)
        {
            case glsl.VEC4:
                gl.uniform4fv(bind, value);
                break;
            case glsl.MAT4:
                gl.uniformMatrix4fv(bind, false, value);
                break;
            case glsl.SAMPLER_2D:
                gl.activeTexture(gl[TextureSlots[shader.boundTextureCount]]);
                gl.bindTexture(gl.TEXTURE_2D, value);
                gl.uniform1i(bind, shader.boundTextureCount);
                shader.boundTextureCount++;
                break;
            case glsl.VEC3:
                gl.uniform3fv(bind, value);
                break;
            case glsl.VEC2:
                gl.uniform2fv(bind, value);
                break;
            case glsl.FLOAT:
                gl.uniform1f(bind, value);
                break;
            case glsl.SAMPLER_CUBE:
                gl.activeTexture(gl[TextureSlots[shader.boundTextureCount]]);
                gl.bindTexture(gl.TEXTURE_CUBE_MAP, value);
                gl.uniform1i(bind, shader.boundTextureCount);
                shader.boundTextureCount++;
                break;
            case glsl.MAT3:
                gl.uniformMatrix3fv(bind, false, value);
                break;
            case glsl.MAT2:
                gl.uniformMatrix2fv(bind, false, value);
                break;
            case glsl.INT:
                gl.uniform1i(bind, value);
                break;
            case glsl.IVEC4:
                gl.uniform4iv(bind, value);
                break;
            case glsl.IVEC3:
                gl.uniform3iv(bind, value);
                break;
            case glsl.IVEC2:
                gl.uniform2iv(bind, value);
                break;
            case glsl.BOOL:
                gl.uniform1i (bind, value);
                break;
            case glsl.BVEC4:
                gl.uniform4iv(bind, value);
                break;
            case glsl.BVEC3:
                gl.uniform3iv(bind, value);
                break;
            case glsl.BVEC2:
                gl.uniform2iv(bind, value);
                break;
        }
        return this;
    };

    /// Creates a texture proxy object, which stores metadata associated
    /// with a texture object, as well as the underlying WebGL resources.
    /// This function may be called from any thread.
    /// @return A new texture proxy object. WebGL resources must be initialized
    /// separately on the main UI thread.
    GLContext.prototype.createTextureProxy = function ()
    {
        return {
            id              : 0,     /* object list id                */
            textureResource : null,  /* WebGLTexture instance         */
            webglContext    : this,  /* WebGLRenderingContext         */
            hasMipmaps      : false, /* texture has a mip-chain?      */
            userType        : '',    /* 'COLOR', etc. user-defined    */
            bindTarget      : 0,     /* gl.TEXTURE_2D, etc.           */
            textureTarget   : 0,     /* gl.TEXTURE_2D, etc.           */
            format          : 0,     /* gl.RGBA, etc.                 */
            dataType        : 0,     /* gl.UNSIGNED_BYTE, etc.        */
            wrapModeS       : 0,     /* gl.CLAMP_TO_EDGE, etc.        */
            wrapModeT       : 0,     /* gl.CLAMP_TO_EDGE, etc.        */
            magnifyFilter   : 0,     /* gl.LINEAR, etc.               */
            minifyFilter    : 0,     /* gl.LINEAR_MIPMAP_LINEAR, etc. */
            levels          : []     /* mipmap level dimensions       */
        };
    };

    /// Deletes a texture proxy object. WebGL resources must be deleted
    /// separately. This function may be called from any thread.
    /// @param proxy The texture proxy object as returned by the function
    /// @a GLContext.createTextureProxy().
    /// @return The GLContext.
    GLContext.prototype.deleteTextureProxy = function (proxy)
    {
        if (proxy)
        {
            // release references held by the texture object.
            proxy.textureResource = null;
            proxy.webglContext    = null;
            proxy.userType        = null;
            proxy.levels          = null;
            proxy.bindTarget      = 0;
            proxy.textureTarget   = 0;
            proxy.format          = 0;
            proxy.dataType        = 0;
            proxy.wrapModeS       = 0;
            proxy.wrapModeT       = 0;
            proxy.magnifyFilter   = 0;
            proxy.minifyFilter    = 0;
        }
        return this;
    };

    /// Creates a texture resource. The contents of the texture are initialized
    /// to transparent black. Use the uploadTexture() or uploadTextureRegion()
    /// functions to specify image data.
    /// @param proxy The texture proxy object as returned by the function
    /// @a GLContext.createTextureProxy().
    /// @param args An object specifying texture attributes. All are required.
    /// @param args.type A string value specifying a user-defined texture type
    /// attribute. This typically describes the usage of the texture, for
    /// example, 'COLOR' for a texture containing color data, 'NORMAL' for a
    /// normal map texture, and so on.
    /// @param args.target A value specifying the texture target: TEXTURE_2D,
    /// TEXTURE_CUBE_MAP_POSITIVE_[X,Y,Z] or TEXTURE_CUBE_MAP_NEGATIVE_[X,Y,Z].
    /// @param args.format A value specifying the texture type. May be one of
    /// ALPHA, LUMINANCE, LUMINANCE_ALPHA, RGB or RGBA.
    /// @param args.dataType A value specifying the format of the texture data.
    /// One of UNSIGNED_BYTE, UNSIGNED_SHORT_5_6_5, UNSIGNED_SHORT_4_4_4_4,
    /// UNSIGNED_SHORT_5_5_5_1, HALF_FLOAT_OES or FLOAT.
    /// @param args.wrapS A value specifying the wrapping mode to use in the
    /// horizontal direction. One of REPEAT, CLAMP_TO_EDGE or MIRRORED_REPEAT.
    /// @param args.wrapT A value specifying the wrapping mode to use in the
    /// vertical direction. One of REPEAT, CLAMP_TO_EDGE or MIRRORED_REPEAT.
    /// @param args.magFilter A value specifying the filter to use when the
    /// texture is magnified. One of NEAREST or LINEAR.
    /// @param args.minFilter A value specifying the filter to use when the
    /// texture is minified. One of NEAREST, LINEAR, NEAREST_MIPMAP_NEAREST,
    /// LINEAR_MIPMAP_NEAREST, NEAREST_MIPMAP_LINEAR or LINEAR_MIPMAP_LINEAR.
    /// @param args.hasMipmaps A boolean value specifying whether the texture
    /// has an associated mip-chain.
    /// @param args.levels An array of objects describing each level in the
    /// mipmap chain. Level 0 represents the highest-resolution image. Each
    /// level object has width, height, byteSize and byteOffset fields.
    /// @return true if the texture resource is created successfully.
    GLContext.prototype.createTextureResource = function (proxy, args)
    {
        var textureTarget   = gl[args.target];
        var bindTarget      = gl[args.target];
        if (bindTarget    === gl.TEXTURE_CUBE_MAP_POSITIVE_X ||
            bindTarget    === gl.TEXTURE_CUBE_MAP_POSITIVE_Y ||
            bindTarget    === gl.TEXTURE_CUBE_MAP_POSITIVE_Z ||
            bindTarget    === gl.TEXTURE_CUBE_MAP_NEGATIVE_X ||
            bindTarget    === gl.TEXTURE_CUBE_MAP_NEGATIVE_Y ||
            bindTarget    === gl.TEXTURE_CUBE_MAP_NEGATIVE_Z)
            bindTarget      = gl.TEXTURE_CUBE_MAP;

        // create the texture resource and cache various attributes.
        var resource   = gl.createTexture();
        if (resource === null)
        {
            // likely the context is lost.
            return false;
        }
        proxy.webglContext    = gl;
        proxy.textureResource = gl.createTexture();
        proxy.hasMipmaps      = args.hasMipmaps;
        proxy.userType        = args.type;
        proxy.bindTarget      = bindTarget;
        proxy.textureTarget   = textureTarget;
        proxy.format          = gl[args.format];
        proxy.dataType        = gl[args.dataType];
        proxy.wrapModeS       = gl[args.wrapS];
        proxy.wrapModeT       = gl[args.wrapT];
        proxy.magnifyFilter   = gl[args.magFilter];
        proxy.minifyFilter    = gl[args.minFilter];
        proxy.levels          = new Array(args.levels.length);
        for (var i = 0,  n  = args.levels.length; i < n; ++i)
        {
            proxy.levels[i]   = {
                width       : args.levels[i].width,
                height      : args.levels[i].height,
                byteSize    : args.levels[i].byteSize,
                byteOffset  : args.levels[i].byteOffset
            };
        }

        // bind the texture and set GL attributes.
        gl.bindTexture  (bindTarget, proxy.textureResource);
        gl.texParameteri(bindTarget, gl.TEXTURE_WRAP_S,     proxy.wrapModeS);
        gl.texParameteri(bindTarget, gl.TEXTURE_WRAP_T,     proxy.wrapModeT);
        gl.texParameteri(bindTarget, gl.TEXTURE_MIN_FILTER, proxy.minifyFilter);
        gl.texParameteri(bindTarget, gl.TEXTURE_MAG_FILTER, proxy.magnifyFilter);
        return true;
    };

    /// Deletes the WebGL resources associated with a texture. This function
    /// can only be called on the main UI thread.
    /// @param proxy The texture proxy object as returned by the function
    /// @a GLContext.createTextureProxy().
    /// @return The GLContext.
    GLContext.prototype.deleteTextureResource = function (proxy)
    {
        if (proxy && proxy.webglContext === this)
        {
            var unit   = this.activeTextureIndex;
            var list   = this.activeTextures;
            var runit  = unit;
            var bound  = false;
            for (var i = 0, n = list.length; i < n; ++i)
            {
                if (list[i] === proxy)
                {
                    this.useTextureUnit(i);
                    this.unbindTexture();
                    if (i === unit)
                    {
                        // we unbound the active unit.
                        // select unit zero on return.
                        runit = 0;
                    }
                    bound = true;
                }
            }
            if (bound) this.useTextureUnit(runit);

            var gl = proxy.webglContext.gl;
            gl.deleteTexture(proxy.textureResource);
            proxy.textureResource = null;
        }
        return this;
    };

    /// Uploads the complete mip-chain for a texture to the GPU.
    /// @param data A Uint8Array view storing the raw data for each mip-level.
    /// @return The GLContext.
    GLContext.prototype.uploadTexture = function (data)
    {
        var  unit    = this.activeTextureIndex;
        var  proxy   = this.activeTextures[unit];
        if (!proxy)    return this;

        var  gl      = this.gl;
        var  buffer  = data.buffer;
        var  baseOfs = data.byteOffset;
        var  type    = proxy.dataType;
        var  format  = proxy.format;
        var  target  = proxy.textureTarget;
        gl.bindTexture(proxy.bindTarget, proxy.textureResource);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        for (var i   = 0, n = proxy.levels.length; i < n; ++i)
        {
            var ld   = proxy.levels[i];
            var lw   = ld.width;
            var lh   = ld.height;
            var ofs  = ld.byteOffset + baseOfs;
            var size = ld.byteSize;
            var view = null;
            switch (type)
            {
                case gl.UNSIGNED_BYTE:
                    view = new Uint8Array(buffer, ofs, size);
                    break;
                case gl.UNSIGNED_SHORT_5_6_5:
                case gl.UNSIGNED_SHORT_5_5_5_1:
                case gl.UNSIGNED_SHORT_4_4_4_4:
                    view = new Uint16Array(buffer, ofs, size >> 1);
                    break;

                default: break;
            }
            gl.texImage2D(target, i, format, lw, lh, 0, format, type, view);
        }
        return this;
    };

    /// Uploads data to a texture object from a DOM Canvas, Image or Video
    /// element. Only level 0 of the target texture is modified.
    /// @param domElement An instance of HTMLImageElement, HTMLCanvasElement
    /// or HTMLVideoElement specifying the source texture data.
    /// @return The GLContext.
    GLContext.prototype.uploadTextureFromDOM = function (domElement)
    {
        var  unit    = this.activeTextureIndex;
        var  proxy   = this.activeTextures[unit];
        if (!proxy)    return this;

        var  gl      = this.gl;
        var  type    = proxy.dataType;
        var  format  = proxy.format;
        gl.bindTexture(proxy.bindTarget, proxy.textureResource);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(proxy.textureTarget, 0, format, format, type, domElement);
        return this;
    };

    /// Uploads image data to a region of a texture.
    /// @param tX The x-coordinate (s-coordinate) of the upper-left corner of
    /// the target rectangle.
    /// @param tY The y-coordinate (t-coordinate) of the upper-left corner of
    /// the target rectangle.
    /// @param tLevel The zero-based index of the target mip-level, where level
    /// zero represents the highest resolution image.
    /// @param source An object storing metadata about the source image.
    /// @param source.levels An array of objects describing each level in the
    /// mipmap chain. Level 0 represents the highest resolution image. Each
    /// level object has width, height, byteSize and byteOffset fields.
    /// @param sLevel The zero-based index of the source mip-level, where level
    /// zero represents the highest resolution image.
    /// @param data A Uint8Array view storing the raw data for each mip-level
    /// of the source image.
    /// @return The GLContext.
    GLContext.prototype.uploadTextureRegion = function (tX, tY, tLevel, source, sLevel, data)
    {
        var  unit    = this.activeTextureIndex;
        var  target  = this.activeTextures[unit];
        if (!target)   return this;

        var  gl      = this.gl;
        var  tt      = target.textureTarget;
        var  type    = target.dataType;
        var  format  = target.format;
        var  level   = source.levels[sLevel];
        var  lw      = level.width;
        var  lh      = level.height;
        var  ofs     = level.byteOffset + data.byteOffset;
        var  size    = level.byteSize;
        var  view    = null;
        switch (type)
        {
            case gl.UNSIGNED_BYTE:
                view = new Uint8Array(data.buffer, ofs, size);
                break;
            case gl.UNSIGNED_SHORT_5_6_5:
            case gl.UNSIGNED_SHORT_5_5_5_1:
            case gl.UNSIGNED_SHORT_4_4_4_4:
                view = new Uint16Array(data.buffer, ofs, size >> 1);
                break;

            default: break;
        }
        gl.bindTexture(target.bindTarget, target.textureResource);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texSubImage2D(tt, tLevel, tX, tY, lw, lh, format, type, view);
        return this;
    };

    /// Creates a buffer proxy object, which stores metadata associated
    /// with a buffer object, as well as the underlying WebGL resources.
    /// This function may be called from any thread.
    /// @return A new buffer proxy object. WebGL resources must be initialized
    /// separately on the main UI thread.
    GLContext.prototype.createBufferProxy = function ()
    {
        return {
            id             : 0,    /* object list id                     */
            bufferResource : null, /* WebGLBuffer instance               */
            webglContext   : this, /* WebGLRenderingContext              */
            bindTarget     : 0,    /* ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER */
            usageType      : 0,    /* STATIC_DRAW, STREAM_DRAW, etc.     */
            totalSize      : 0,    /* total size, specified in bytes     */
            elementSize    : 0,    /* byte size of a 'vertex' or index   */
            elementCount   : 0     /* number of vertices or indices      */
        };
    };

    /// Deletes a buffer proxy object. WebGL resources must be deleted
    /// separately. This function may be called from any thread.
    /// @param proxy The buffer proxy object as returned by the function
    /// @a GLContext.createBufferProxy().
    /// @return The GLContext.
    GLContext.prototype.deleteBufferProxy = function (proxy)
    {
        if (proxy)
        {
            // release references held by the buffer object.
            proxy.bufferResource = null;
            proxy.webglContext   = null;
            proxy.bindTarget     = 0;
            proxy.usageType      = 0;
            proxy.totalSize      = 0;
            proxy.elementSize    = 0;
            proxy.elementCount   = 0;
        }
        return this;
    };

    /// Creates the WebGL resources associated with a data buffer. This
    /// function can only be called from the main UI thread.
    /// @param proxy The buffer proxy object as returned by the function
    /// @a GLContext.createBufferProxy().
    /// @param args An object specifying buffer attributes. All are required.
    /// @param args.target A value specifying the buffer target: either
    /// ARRAY_BUFFER or ELEMENT_ARRAY_BUFFER.
    /// @param args.usage A value specifying the buffer usage type; may be one
    /// of STATIC_DRAW, STREAM_DRAW or DYNAMIC_DRAW.
    /// @param args.elementSize The size of a single logical element in bytes.
    /// @param args.elementCount The total number of logical elements in the
    /// buffer (the number of vertices or indices).
    /// @return true if the buffer was created successfully.
    GLContext.prototype.createBufferResource = function (proxy, args)
    {
        if (proxy && proxy.webglContext === this)
        {
            var gl = proxy.webglContext.gl;
            proxy.bufferResource = gl.createBuffer();
            proxy.bindTarget     = gl[args.target];
            proxy.usageType      = gl[args.usage];
            proxy.totalSize      = args.elementSize * args.elementCount;
            proxy.elementSize    = args.elementSize;
            proxy.elementCount   = args.elementCount;
            gl.bindBuffer(proxy.bindTarget, proxy.bufferResource);
            gl.bufferData(proxy.bindTarget, proxy.totalSize, proxy.usageType);
            return true;
        }
        return false;
    };

    /// Deletes the WebGL resources associated with a buffer. This function
    /// can only be called on the main UI thread.
    /// @param proxy The buffer proxy object as returned by the function
    /// @a GLContext.createBufferProxy().
    /// @return The GLContext.
    GLContext.prototype.deleteBufferResource = function (proxy)
    {
        if (proxy && proxy.webglContext  === this)
        {
            if (this.activeArrayBuffer   === proxy ||
                this.activeElementBuffer === proxy)
                this.unbindBuffer(proxy.bindTarget);

            var gl = proxy.webglContext.gl;
            gl.deleteBuffer(proxy.bufferResource);
            proxy.bufferResource = null;
        }
        return this;
    };

    /// Uploads data into an array buffer.
    /// @param data The data to upload into the buffer. This may be either a
    /// standard JavaScript array or a typed array.
    /// @return The GLContext.
    GLContext.prototype.uploadArrayBufferData = function (data)
    {
        if (!this.activeArrayBuffer)
            return this;
        var gl   = this.gl;
        var buf  = this.activeArrayBuffer;
        gl.bufferData(gl.ARRAY_BUFFER, data, buf.usageType);
        return this;
    };

    /// Uploads data into an index buffer.
    /// @param data The data to upload into the buffer. This may be either a
    /// standard JavaScript array or a typed array.
    /// @return The GLContext.
    GLContext.prototype.uploadIndexBufferData = function (data)
    {
        if (!this.activeElementBuffer)
            return this;
        var gl   = this.gl;
        var buf  = this.activeElementBuffer;
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, buf.usageType);
        return this;
    };

    /// Uploads data into a region of an array buffer.
    /// @param byteOffset The byte offset in the array buffer.
    /// @param data The data to upload into the buffer. This may be either a
    /// standard JavaScript array or a typed array.
    /// @return The GLContext.
    GLContext.prototype.uploadArrayBufferRegion = function (byteOffset, data)
    {
        if (!this.activeArrayBuffer)
            return this;
        var gl   = this.gl;
        var buf  = this.activeArrayBuffer;
        gl.bufferSubData(gl.ARRAY_BUFFER, byteOffset, data);
        return this;
    };

    /// Uploads data into a region of an index buffer.
    /// @param byteOffset The byte offset in the index buffer.
    /// @param data The data to upload into the buffer. This may be either a
    /// standard JavaScript array or a typed array.
    /// @return The GLContext.
    GLContext.prototype.uploadIndexBufferRegion = function (byteOffset, data)
    {
        if (!this.activeElementBuffer)
            return this;
        var gl   = this.gl;
        var buf  = this.activeElementBuffer;
        gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, byteOffset, data);
        return this;
    };

    /// Creates an object describing a vertex attribute within an array buffer.
    /// @param name The name of the attribute. This should match the name of
    /// the corresponding attribute in the vertex shader.
    /// @param type One of BYTE, UNSIGNED_BYTE, SHORT, UNSIGNED_SHORT, INT,
    /// UNSIGNED_INT or FLOAT indicating how the data should be interpreted.
    /// @param offset The byte offset of the attribute from the start of the
    /// vertex record.
    /// @param dimension The number of values of the specified type that make
    /// up the attribute; for example, 3 indicates a 3-component vector.
    /// @param normalize A boolean value indicating whether the hardware should
    /// convert non-floating point data into the range [0, 1] before use. The
    /// default value is false.
    /// @return An object describing the vertex attribute.
    /// obj.name The name of the attribute.
    /// obj.dataType The WebGL data type of the attribute.
    /// obj.byteOffset The byte offset from the start of the vertex.
    /// obj.dimension The number of values that make up the attribute.
    /// obj.normalize A boolean value indicating whether the hardware will
    /// convert non-floating point data into the range [0, 1] before use.
    GLContext.prototype.createAttribute = function createAttribute(name, type, offset, dimension, normalize)
    {
        return {
            name       : name,
            dataType   : this.gl[type],
            byteOffset : offset,
            dimension  : dimension,
            normalize  : normalize || false
        };
    };

    /// Sets the array buffer data sources for each vertex attribute for the
    /// active program object.
    /// @param attributes An array of vertex attribute descriptors. See the
    /// function @a GLContext.createAttribute().
    /// @param buffers An array of buffer resource proxies specifying the data
    /// sources for each vertex attribute. Items in this array have a one-to-one
    /// correspondence with @a attributes, such that attributes[i] is sourced
    /// from buffers[i].
    /// @return The GLContext.
    GLContext.prototype.enableAttributes = function (attributes, buffers)
    {
        if (!this.activeProgram)
            return this;

        var gl      = this.gl;
        var shader  = this.activeProgram;
        var indices = shader.attributeIndices;
        for (var i  = 0, n = attributes.length; i < n; ++i)
        {
            var ar  = attributes[i];
            var ab  = buffers[i];
            var ai  = indices[ar.name];
            gl.enableVertexAttribArray(ai);
            gl.vertexAttribPointer(
                ai,
                ar.dimension,
                ar.dataType,
                ar.normalize,
                ab.elementSize,
                ar.byteOffset);
        }
        return this;
    };

    /// Sets a constant vertex attribute value for the active program object.
    /// @param name The name of the attribute. This should match the name of
    /// the attribute in the currently bound vertex shader.
    /// @param value The constant attribute value. For vector attribute types
    /// this is either a JavaScript Number array or Float32Array instance. For
    /// scalar attribute types, this is a single JavaScript Number value.
    /// @return The GLContext.
    GLContext.prototype.setConstantAttribute = function (name, value)
    {
        if (!this.activeProgram)
            return this;

        var     gl     = this.gl;
        var     glsl   = TypeNames;
        var     shader = this.activeProgram;
        var     index  = shader.attributeIndices[name];
        var     type   = shader.attributeTypes[name];
        switch (type)
        {
            case glsl.VEC4:
                gl.vertexAttrib4fv(index, value);
                break;
            case glsl.VEC3:
                gl.vertexAttrib3fv(index, value);
                break;
            case glsl.VEC2:
                gl.vertexAttrib2fv(index, value);
                break;
            case glsl.FLOAT:
                gl.vertexAttrib1f(index, value);
                break;
        }
        gl.disableVertexAttribArray(index); // use the constant attribute value
        return this;
    }

    /// Computes the size of a single buffer attribute, in bytes, based on its
    /// type and dimension.
    /// @param attribute A vertex attribute descriptor. See the function
    /// @a GLContext.createAttribute().
    /// @return The size of the specified vertex attribute, in bytes.
    GLContext.prototype.computeAttributeSize = function (attribute)
    {
        if (!attribute)
            return 0;

        var     gl = this.gl;
        switch (attribute.dataType)
        {
            case gl.FLOAT:
            case gl.INT:
            case gl.UNSIGNED_INT:
                return 4 * attribute.dimension;
            case gl.BYTE:
            case gl.UNSIGNED_BYTE:
                return 1 * attribute.dimension;
            case gl.SHORT:
            case gl.UNSIGNED_SHORT:
                return 2 * attribute.dimension;
            default:
                break;
        }
        return 0;
    };

    /// Computes the size of a logical buffer element composed of one or more
    /// sub-elements.
    /// @param attributes The vertex attribute descriptors for each sub-element
    /// in the buffer. See the function @a GLContext.createAttribute().
    /// @return The size of the specified buffer element, in bytes.
    GLContext.prototype.computeBufferElementSize = function (attributes)
    {
        var count  = attributes.length;
        if (count == 0)
            return 0;

        // sum the byte offsets and then add in the size of the final attribute.
        // this ensures that we properly account for any user-added padding.
        var total  = 0;
        for (var i = 0, n = count - 1; i < n; ++i)
            total += attributes[i].byteOffset;
        return total + this.computeAttributeSize(attributes[count-1]);
    };

    /// Given a set of vertex attribute definitions and a set of arrays filled
    /// with data for each individual attribute, constructs an interleaved
    /// ArrayBuffer containing the vertex data.
    /// @param attributes The vertex attribute descriptors for each sub-element
    /// in the buffer. See the function @a GLContext.createAttribute().
    /// @param arrays An array of JavaScript arrays. Each element specifies the
    /// data for the corresponding vertex attribute.
    /// @param count The number of vertices specified by the arrays.
    /// @return A new ArrayBuffer instance containing the interleaved data.
    GLContext.prototype.interleaveArrays = function (attributes, arrays, count)
    {
        var gl     = this.gl;
        var esize  = this.computeBufferElementSize(attributes);
        var buffer = new ArrayBuffer(esize * count);
        var offset = new Array(attributes.length);
        var sizes  = new Array(attributes.length);
        var views  = new Array(attributes.length);

        // create views of buffer; pre-calculate sizes and offsets for each.
        for (var i = 0, n = attributes.length; i < n; ++i)
        {
            var ar = attributes[i];
            switch  (ar.dataType)
            {
                case gl.FLOAT:
                    views[i]    = new Float32Array(buffer);
                    sizes[i]    = esize         / 4; // 4 = sizeof(float)
                    offset[i]   = ar.byteOffset / 4; // 4 = sizeof(float)
                    break;
                case gl.UNSIGNED_BYTE:
                    views[i]    = new Uint8Array(buffer);
                    sizes[i]    = esize;
                    offset[i]   = ar.byteOffset;
                    break;
                case gl.UNSIGNED_SHORT:
                    views[i]    = new Uint16Array(buffer);
                    sizes[i]    = esize         / 2; // 2 = sizeof(uint16_t)
                    offset[i]   = ar.byteOffset / 2; // 2 = sizeof(uint16_t)
                    break;
                case gl.UNSIGNED_INT:
                    views[i]    = new Uint32Array(buffer);
                    sizes[i]    = esize         / 4; // 4 = sizeof(uint32_t)
                    offset[i]   = ar.byteOffset / 4; // 4 = sizeof(uint32_t)
                    break;
                case gl.BYTE:
                    views[i]    = new Int8Array(buffer);
                    sizes[i]    = esize;
                    offset[i]   = ar.byteOffset;
                    break;
                case gl.SHORT:
                    views[i]    = new Int16Array(buffer);
                    sizes[i]    = esize         / 2; // 2 = sizeof(int16_t)
                    offset[i]   = ar.byteOffset / 2; // 2 = sizeof(int16_t)
                    break;
                case gl.INT:
                    views[i]    = new Int32Array(buffer);
                    sizes[i]    = esize         / 4; // 4 = sizeof(int32_t)
                    offset[i]   = ar.byteOffset / 4; // 4 = sizeof(int32_t)
                    break;
                default:
                    // vertex attribute has an invalid type.
                    return null;
            }
        }

        // copy data to the interleaved array.
        for (var i = 0; i < count; ++i) /* each vertex */
        {
            for (var j = 0, n = attributes.length; j < n; ++j) /* each attrib */
            {
                var ar = attributes[j];// select the vertex attribute record
                var sa = arrays[j];    // select the source data array
                var o  = offset[j];    // offset of element in FLOAT, etc.
                var dv = views[j];     // view for element
                var vd = ar.dimension; // vector dimension
                var bi = i * vd;       // base index of vertices[i] data
                for (var k = 0; k < vd; ++k)
                    dv[o + k]  = sa[bi  + k];
                offset[j] += sizes[j]; // move to the next element in view
            }
        }
        return buffer;
    };

    /// Submits a batch of (non-indexed) triangles to be rendered.
    /// @param count The number of vertices to read. The number of triangles
    /// submitted in the batch is @a count / 3.
    /// @param startIndex The zero-based index of the first vertex to read.
    /// @return The GLContext.
    GLContext.prototype.drawPrimitives = function (count, startIndex)
    {
        startIndex  = startIndex || 0;
        var gl      = this.gl;
        gl.drawArrays(gl.TRIANGLES, startIndex, count);
        return this;
    };

    /// Submits a batch of indexed triangles to be rendered.
    /// @param count The number of indices to read. The number of triangles
    /// submitted in the batch is @a count / 3.
    /// @param startIndex The zero-based index of the first vertex index.
    /// @return The GLContext.
    GLContext.prototype.drawIndexed = function (count, startIndex)
    {
        if (!this.activeElementBuffer)
            return this;

        var type;
        var gl      = this.gl;
        var indices = this.activeElementBuffer;
        startIndex  = startIndex || 0;
        var offset  = startIndex  * indices.elementSize;
        switch (indices.elementSize)
        {
            case 1:  type = gl.UNSIGNED_BYTE;   break;
            case 2:  type = gl.UNSIGNED_SHORT;  break;
            case 4:  type = gl.UNSIGNED_INT;    break;
            default: return this;
        }
        gl.drawElements(gl.TRIANGLES, count, type, offset);
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

    /// Set the functions exported from this module.
    exports.Emitter       = Emitter;
    exports.inherits      = inherits;
    exports.isSupported   = isSupported;
    exports.createContext = createContext;
    return exports;
}  (WebGL || {}));
