/*/////////////////////////////////////////////////////////////////////////////
/// @summary Implements the entry point of a real-time JavaScript application.
/// This sample uses webgl.js to render sprites in screen-space.
/// @author Russell Klenk (russ@ninjabirdstudios.com)
///////////////////////////////////////////////////////////////////////////80*/
/// An object storing the global application state.
var State                     = {
    /// The handle returned by window.requestAnimationFrame.
    updateHandle              : 0,
    /// The computed desired presentation time step, in seconds.
    frameTimeStep             : 0.0,
    /// The computed desired simulation time step, in seconds.
    logicTimeStep             : 0.0,
    /// The amount of simulation time for the current frame, in seconds.
    simulationTime            : 0.0,
    /// The amount of simulation time left over from the last frame, in seconds.
    timeAccumulator           : 0.0,
    /// The number of simulation ticks on the current frame.
    simulationCount           : 0,
    /// The current angle measure, specified in radians. This value is used to
    /// animate the quads by applying a dynamic rotation.
    angle                     : 0.0,
    /// The DOM element monitored by window.requestAnimationFrame.
    domElement                : null,
    /// The DOM image element containing our texture data.
    domImage                  : null,
    /// The global application real-time clock state.
    clock                     : null,
    /// The WebGL rendering context.
    webglContext              : null,
    /// The WebGLRenderer.Renderer2d instance.
    renderer                  : null,
    /// The WebGLRenderer.QuadBatch instance.
    batch                     : null,
    /// The WebGLRenderer.QuadEffect instance.
    effect                    : null,
    /// The WebGL viewport descriptor.
    viewport                  : null,
    /// The WebGL texture object proxy for our loaded texture.
    texture                   : null
};

/// Constants representing limit values. We enforce limits on the minimum
/// and maximum rates of simulation and presentation ticks. Generally, the
/// monitor refresh rate (and the browser's window.requestAnimationFrame
/// method) are limited to 60Hz, so we choose this as our minimum and
/// maximum presentation rate; however, the browser may select any suitable
/// presentation interval. Timing-wise we are limited to a resolution of
/// one millisecond, so our simulation rate minimum and maximum are set
/// accordingly. Override the application presentation, simulation and frame
/// request rate here.
var Constants                 = {
    /// The maximum reportable tick duration. If a clock tick duration exceeds
    /// this value, the duration is clamped to this value.
    MAXIMUM_TICK_DURATION     : 1.0 /    2.0,
    /// The minimum reportable tick duration. If a clock tick duration is less
    /// than this value, this value is reported.
    MINIMUM_TICK_DURATION     : 1.0 / 1000.0,
    /// The minimum number of simulation ticks per-second.
    MINIMUM_SIMULATION_RATE   : 1.0,
    /// The maximum number of simulation ticks per-second.
    MAXIMUM_SIMULATION_RATE   : 1000.0,
    /// The minimum number of presentation ticks per-second.
    MINIMUM_PRESENTATION_RATE : 60.0,
    /// The maximum number of presentation ticks per-second.
    MAXIMUM_PRESENTATION_RATE : 60.0,
    /// The number of presentation ticks per-second.
    PRESENTATION_RATE         : 60.0,
    /// The number of simulation ticks per-second.
    SIMULATION_RATE           : 60.0,
    /// The frame request rate of 60 frames per-second.
    FRAME_REQUEST_RATE        : 1000.0 / 60.0
};

/// Default values exported by the module for expected tick duration,
/// minimum tick duration and maximum tick duration. All values are
/// expressed in seconds.
var Clock                     = {
    /// The default duration of a single clock tick, specified in seconds. The
    /// default value is 1/60th of a second, or 60 ticks-per-second.
    DEFAULT_TICK_DURATION     : 1.0 /   60.0,
    /// The maximum reportable tick duration. If a clock tick duration exceeds
    /// this value, the duration is clamped to this value.
    MAXIMUM_TICK_DURATION     : 1.0 /    2.0,
    /// The minimum reportable tick duration. If a clock tick duration is less
    /// than this value, this value is reported.
    MINIMUM_TICK_DURATION     : 1.0 / 1000.0,
};

/// An array of static RGBA color values, packed into 32-bit unsigned integers.
/// Colors[0] is opaque red, Colors[1] opaque green, Colors[2] opaque blue.
var Colors     = [0xFF0000FF, 0x00FF00FF, 0x0000FFFF];

/// Alias QuadBatch for less typing.
var QuadBatch  = WebGLRenderer.QuadBatch;

/// Alias QuadVertex for less typing.
var QuadVertex = WebGLRenderer.QuadVertex;

/// The rotation rate for the sprites, in radians-per-second.
var RadsPerSec = 2.0 * Math.PI;

/// Implements a fallback function based on window.setTimeout() for use
/// in cases where window.requestAnimationFrame() is not available.
/// @param callback A function (time:DOMTimeStamp) : void. The time
/// parameter is not supplied by all browsers.
/// @param element The DOM element being updated. This parameter is unused.
/// @return A handle value that can be used to cancel the timeout before
/// it fires.
function setTimeoutFallback(callback, element)
{
    return window.setTimeout(callback, Constants.FRAME_REQUEST_RATE);
}

/// Store a reference to the supported implementation of the new API
/// http://www.w3.org/TR/animation-timing/#requestAnimationFrame
/// Prototype: handle request_animation_frame(callback, element)
/// The callback takes a single parameter, the current timestamp.
var requestFrame = (function ()
    {
        return window.requestAnimationFrame       ||
               window.webkitRequestAnimationFrame ||
               window.mozRequestAnimationFrame    ||
               window.oRequestAnimationFrame      ||
               window.msRequestAnimationFrame     ||
               setTimeoutFallback;
    })();

/// Store a reference to the supported implementation of the new API
/// http://www.w3.org/TR/animation-timing/#cancelRequestAnimationFrame
/// Prototype: void cancelAnimationFrame(handle)
var cancelFrame  = (function ()
    {
        return window.cancelRequestAnimationFrame       ||
               window.webkitCancelRequestAnimationFrame ||
               window.mozCancelRequestAnimationFrame    ||
               window.oRequestAnimationFrame            ||
               window.msCancelRequestAnimationFrame     ||
               window.clearTimeout;
    })();

/// Constructs a new clock state object.
/// @param expDuration The expected duration of a single clock tick,
/// specified in seconds.
/// @param minDuration The minimum reportable tick duration, in seconds.
/// @param maxDuration The maximum reportable tick duration, in seconds.
/// @param now The current time value, in milliseconds. Typically, the
/// value returned by Date.now() is passed.
/// @return A new object representing the clock state.
function createClock(expDuration, minDuration, maxDuration, now)
{
    var tmpDuration         = 0.0;
    if (isNaN(now)) now     = 0.0;
    if (isNaN(expDuration)) expDuration = Clock.DEFAULT_TICK_DURATION;
    if (isNaN(minDuration)) minDuration = Clock.MINIMUM_TICK_DURATION;
    if (isNaN(maxDuration)) maxDuration = Clock.MAXIMUM_TICK_DURATION;
    if (minDuration <= 0.0) minDuration = Clock.MINIMUM_TICK_DURATION;
    if (maxDuration <= 0.0) maxDuration = Clock.MINIMUM_TICK_DURATION;
    if (minDuration >  maxDuration)
    {
        tmpDuration =  minDuration;
        minDuration =  maxDuration;
        maxDuration =  tmpDuration;
    }
    if (expDuration <  minDuration) expDuration = minDuration;
    return {
        startTimeValue      : now,
        lastTimeValue       : now,
        tickCount           : 0,
        tickDuration        : expDuration,
        clientTime          : 0.0,
        serverTime          : 0.0,
        serverTimeOffset    : 0.0,
        defaultTickDuration : expDuration,
        maximumTickLength   : maxDuration,
        minimumTickLength   : minDuration,
        maximumTickDuration : minDuration, // @note: intentional
        minimumTickDuration : maxDuration  // @note: intentional
    };
}

/// Updates a clock state with a new time sample value.
/// @param state The clock state object to update.
/// @param sampleTime The time sample value used to update the clock,
/// specified in milliseconds.
/// @return The input object @a state.
function updateClock(state, sampleTime)
{
    var tickDelta =(sampleTime - state.lastTimeValue) * 0.001; // ms => sec
    var duration  = tickDelta;
    if (tickDelta > state.maximumTickLength)
    {
        // enforce a maximum tick duration; useful when performing physical
        // simulations to prevent the time step from getting too large.
        duration  = state.maximumTickLength;
    }
    if (tickDelta < state.minimumTickLength)
    {
        // enforce a minimum tick duration; useful when trying to avoid
        // divide-by-zero errors.
        duration  = state.minimumTickLength;
    }

    // update the clock state members.
    state.lastTimeValue  = sampleTime;
    state.tickDuration   = duration;  // report possibly clamped duration
    state.clientTime    += tickDelta; // keep absolute time correct
    state.serverTime     = state.clientTime + state.serverTimeOffset;
    state.tickCount     += 1;

    // update the minimum and maximum observed tick duration. only update
    // these values after one second of sample data has been gathered and
    // timing values start to settle down.
    if (state.clientTime > 1.0)
    {
        if (tickDelta < state.minimumTickDuration)
        {
            // a new minimum tick duration has been observed.
            state.minimumTickDuration = tickDelta;
        }
        if (tickDelta > state.maximumTickDuration)
        {
            // a new maximum tick duration has been observed.
            state.maximumTickDuration = tickDelta;
        }
    }
    return state;
}

/// Resumes a clock instance after a pause period, adjusting its values to
/// prevent a sudden jump in the time delta.
/// @param state The clock state to update.
/// @param resumeTime The current clock sample time value, specified in
/// milliseconds.
/// @return The input object @a state.
function resumeClock(state, resumeTime)
{
    state.lastTimeValue = resumeTime;
    state.tickDuration  = state.defaultTickDuration;
    state.clientTime   += state.defaultTickDuration;
    state.serverTime    = state.clientTime + state.serverTimeOffset;
    state.tickCount    += 1;
    // @note: don't update min/max tick durations.
    return state;
}

/// Computes the current, minimum and maximum number of ticks-per-second
/// for a given clock instance.
/// @param state The clock state object to query.
/// @param result The object used to store the updated clock statistics.
/// This object is updated with currentTPS, minimumTPS and maximumTPS
/// properties. If this reference is null or undefined, a new object is
/// created and returned.
/// @return An object with currentTPS, minimumTPS and maximumTPS
/// properties. If specified, the @a result object is returned; otherwise,
/// a new object is returned.
function clockStatistics(state, result)
{
    if (!result)
    {
        result = {
            currentTPS    : 1.0 / state.tickDuration,
            minimumTPS    : 1.0 / state.maximumTickDuration,
            maximumTPS    : 1.0 / state.minimumTickDuration
        };
    }
    else
    {
        result.currentTPS = 1.0 / state.tickDuration;
        result.minimumTPS = 1.0 / state.maximumTickDuration;
        result.maximumTPS = 1.0 / state.minimumTickDuration;
    }
    return result;
}

/// Loads text from a script node and returns the script string.
/// @param element_id The ID of the script element to read.
/// @return A string containing the text read from the script element, or an
/// empty string if no element with the specified ID was found.
function loadScriptFromDOM(element_id)
{
    var  element = document.getElementById(element_id);
    if (!element) return '';

    var    scriptSource = '';
    var    currentChild = element.firstChild;
    while (currentChild)
    {
        if (currentChild.nodeType == 3) /* a text node */
        {
            scriptSource += currentChild.textContent;
        }
        currentChild = currentChild.nextSibling;
    }
    return scriptSource;
}

/// Creates any GPU resources depending on having a valid WebGL context. This
/// function is called at init time, and whenever the WebGL context is restored.
function createGraphicsResources()
{
    var dom = State.domElement;
    var gl  = State.webglContext;
    var gr  = State.renderer;
    var vss = loadScriptFromDOM('vert'); // @note: shouldn't reload each time
    var fss = loadScriptFromDOM('frag'); // @note: shouldn't reload each time
    var url = 'https://lh3.googleusercontent.com/-nGV4Ts7a3ZE/UK0h-yHOyyI/AAAAAAAAAOM/VPpste26ceQ/s912/2012_11_21_19_47.jpg';

    State.webglContext.gl.clearColor(0.0, 0.0, 0.0, 1.0);
    State.webglContext.gl.clearDepth(0.0);
    State.webglContext.gl.clearStencil(0);

    // set the viewport to be the entire canvas.
    State.viewport.x      = 0;
    State.viewport.y      = 0;
    State.viewport.width  = dom.width;
    State.viewport.height = dom.height;
    State.viewport.near   = 1.0;
    State.viewport.far    = 1000.0;
    gl.applyViewport(State.viewport);

    // setup the effect used to render the QuadBatch.
    // PTCG means vertices have position, texture, color and generic attributes.
    // the effect can render up to 2048 quads in a single draw call.
    State.effect.applyViewport(dom.width, dom.height);
    State.effect.createResources(vss, fss, QuadVertex.PTCG, 2048);
    State.effect.blendState = State.effect.blendStateNone;

    // load a DOM texture and upload it to the GPU.
    // pull from Picasa web galleries because they support CORS.
    // @note: non-power of two images only support CLAMP_TO_EDGE.
    State.domImage        = new Image();
    State.domImage.onload = function ()
        {
            var width     = State.domImage.width;
            var height    = State.domImage.height;
            gl.useTextureUnit(0);
            gl.createTextureResource(State.texture, {
                type      : 'COLOR',
                target    : 'TEXTURE_2D',
                format    : 'RGB',
                dataType  : 'UNSIGNED_BYTE',
                wrapS     : 'CLAMP_TO_EDGE',
                wrapT     : 'CLAMP_TO_EDGE',
                magFilter : 'LINEAR',
                minFilter : 'NEAREST',
                hasMipmaps: false,
                levels    : [
                    {
                        width      : width,
                        height     : height,
                        byteSize   : width * height,
                        byteOffset : 0
                    }
                ]
            });
            gl.uploadTextureFromDOM(State.domImage);
            gl.unbindTexture();
        };
    State.domImage.crossOrigin = '';  // for CORS
    State.domImage.src         = url;
}

/// Callback invoked when the WebGL context is lost.
/// @param context The GLContext instance reporting the event.
function webGL_ContextLost(context)
{
    console.log('Rendering context was lost.');
}

/// Callback invoked when the WebGL context is restored.
/// @param context The GLContext instance reporting the event.
function webGL_ContextRestored(context)
{
    console.log('Rendering context was restored.');
    createGraphicsResources();
}

/// Callback invoked when the GLContext encounters an error compiling vertex or
/// fragment shader source code.
/// @param context The GLContext instance reporting the error.
/// @param stage One of the @a WebGL.BuildStage values indicating whether the
/// error occurred while compiling the vertex shader or the fragment shader.
/// @param sourceCode The shader source code being compiled.
/// @param log The error log generated by the compiler.
function webGL_CompileError(context, stage, sourceCode, log)
{
    console.log('Error compiling shader program:');
    console.log('Message: '+log);
    console.log('Source:  '+sourceCode);
}

/// Callback invoked when the GLContext encounters an error linking a vertex
/// and fragment shader together to form a complete program.
/// @param context The GLContext instance reporting the error.
/// @param stage This value is always @a WebGL.BuildStage.LINK_PROGRAM.
/// @param sourceCode The concatenated vertex and fragment shader source code.
/// @param log The error log generated by the compiler.
function webGL_LinkerError(context, stage, sourceCode, log)
{
    console.log('Error linking shader program:');
    console.log('Message: '+log);
    console.log('Source:  '+sourceCode);
}

/// Callback invoked when all DOM elements have been loaded. The global State
/// object is initialized here and the WebGL context is created.
function init()
{
    var mind              = Constants.MINIMUM_TICK_DURATION;
    var maxd              = Constants.MAXIMUM_TICK_DURATION;
    var expd              = 1.0 / Constants.PRESENTATION_RATE;
    var dom               = document.getElementById('canvas');
    var now               = Date.now();
    State.clock           = createClock(expd, mind, maxd, now);
    State.frameTimeStep   = 1.0 / Constants.PRESENTATION_RATE;
    State.logicTimeStep   = 1.0 / Constants.SIMULATION_RATE;
    State.simulationTime  = 0.0;
    State.timeAccumulator = 0.0;
    State.simulationCount = 0;
    State.domElement      = dom;
    State.domImage        = null;
    State.webglContext    = WebGL.createContext(dom, true, {
        alpha             : true,
        depth             : true,
        stencil           : true,
        antialias         : true,
        premultipliedAlpha: true
    });
    State.viewport        = State.webglContext.createViewport();
    State.texture         = State.webglContext.createTextureProxy();
    State.renderer        = WebGLRenderer.createRenderer(State.webglContext);
    State.batch           = WebGLRenderer.createQuadBatch(4096);
    State.effect          = State.renderer.createQuadEffect();

    // install handlers for context lost/restored events.
    State.webglContext.on('context:lost',     webGL_ContextLost);
    State.webglContext.on('context:restored', webGL_ContextRestored);
    State.webglContext.on('compile:error',    webGL_CompileError);
    State.webglContext.on('linker:error',     webGL_LinkerError);

    // create GPU resources that depend on having a valid WebGL context.
    createGraphicsResources();
}

/// Callback invoked when all resources (scripts, styles, images, etc.)
/// embedded within the page have been loaded. At this point, we can start
/// the real-time update loop for the application.
function start()
{
    // request notification when it's time to generate the next frame.
    // this starts the real-time update loop. we continue until the
    // caller-supplied tick callback returns false.
    State.updateHandle = requestFrame(frameCallback, State.domElement);
}

/// The default runtime driver module tick callback function. The driver
/// tick callback is invoked every time an animation frame is requested.
/// @param elapsedTime The elapsed time since the last tick, in seconds.
/// @param currentTime The current absolute time value, in seconds.
/// @return true to execute the simulation and presentation portions of the
/// tick, or false to cancel the tick.
function tick(elapsedTime, currentTime)
{
    return true;
}

/// Callback invoked when the effect is selected for rendering. This callback
/// invoked once when the effect is bound and should set up any state that
/// remains constant for all quads.
/// @param effect The QuadEffect instance calling the function.
/// @param gl The GLContext used for rendering.
/// @param program The WebGL program resource proxy.
/// @param matrix A Float32Array representing the projection matrix for the
/// current viewport. This is initialized previously by calling the method
/// @a WebGLRenderer.QuadEffect.applyViewport(width, height).
function setupEffect(effect, gl, program, matrix)
{
    program.boundTextureCount = 0;
    gl.setUniform('uMSS', matrix);
}

/// Callback invoked when the effect needs to change the per-quad state. This
/// function is effect-specific. In this case, it just changes the texture
/// bound to the 'uTEX' uniform in the shader.
/// @param effect The QuadEffect instance calling the function.
/// @param gl The GLContext used for rendering.
/// @param program The WebGL program resource proxy.
/// @param state The application-defined, per-quad state to apply.
function applyState(effect, gl, program, state)
{
    gl.setUniform('uTEX', state);
}

/// The default runtime driver module presentation callback function. The
/// presentation callback is invoked exactly once per requested animation
/// frame, as long as simulation data is available.
/// @param elapsedTime The elapsed time since the last tick, in seconds.
/// @param currentTime The current absolute time value, in seconds.
/// @param tickTime A normalized time value in [0, 1] representing how far
/// into the current tick the driver is at the time of the call.
function present(elapsedTime, currentTime, tickTime)
{
    var gl         = State.webglContext.gl;
    var gr         = State.renderer;
    var batch      = State.batch;
    var effect     = State.effect;
    var clearFlags = gl.COLOR_BUFFER_BIT |
                     gl.DEPTH_BUFFER_BIT |
                     gl.STENCIL_BUFFER_BIT;

    // quad submission. this adds quads to the batch.
    // the rendering doesn't happen until later.
    var c  = 0;
    var C  = Colors;
    var a  = State.angle;
    var w  = 16;
    var h  = 16;
    var ox = w / 2, oy = h / 2;
    var sx = 1.0,   sy = 1.0;
    for (var y = 0;  y < 768; y += 16)
    {
        for (var x = 0; x < 1024; x += 16)
        {
            batch.add(
                State.texture, // per-quad render state (effect specific)
                x+ox, y+oy,    // x, y of quad in screen-space
                1,             // layer depth of quad (0 = closest to screen)
                ox, oy,        // relative origin point for rotation/scale
                sx, sy,        // scale factors
                a,             // angle of orientation
                C[c++],        // tint color, as RGBA uint32_t
                0, 0, w, h,    // sub-rectangle on source image
                w, h);         // width and height of source image
            c = c % 3;
        }
    }
    State.angle += (elapsedTime * RadsPerSec);

    // perform the actual rendering. note that the same
    // effect can be used to render multiple batches.
    gl.clear(clearFlags);
    effect.makeCurrent(setupEffect);
    effect.drawBatch(batch, QuadVertex.ptcg, applyState);
    batch.flush();
}

/// The default runtime river module simulation callback function. The
/// simulation callback may be invoked one or more times per-frame.
/// @param elapsedTime The elapsed time since the last tick, in seconds.
/// @param currentTime The current absolute time value, in seconds.
function simulate(elapsedTime, currentTime)
{
    /* empty */
}

/// Internal callback invoked when the system requests the next frame.
/// @param currTime The current timestamp value, in milliseconds. This
/// value is not supplied by all browsers.
function frameCallback(currTime)
{
    // some browsers do not specify the current time.
    if (!currTime)
    {
        // Date.now() returns the current time in milliseconds, which is
        // the same as the value that would be passed in as currTime.
        currTime = Date.now();
    }

    // cache all of our global state values into local variables.
    var clockState     = State.clock;
    var logicStep      = State.logicTimeStep;
    var frameStep      = State.frameTimeStep;
    var currentTime    = 0.0;
    var elapsedTime    = 0.0;

    // immediately schedule the next update. this lets us stay as close
    // to 60 Hz as possible if we're forced to use the setTimeout fallback.
    State.updateHandle = requestFrame(frameCallback, State.domElement);

    // indicate the start of a new tick on the clock.
    updateClock(clockState,currTime);
    currentTime = clockState.clientTime;
    elapsedTime = clockState.tickDuration;

    // always execute the tick callback.
    if (!tick(elapsedTime, currentTime))
    {
        // the tick callback returned false. cancel this frame.
        return cancelFrame(State.updateHandle);
    }

    // execute the logic callback. the callback may execute zero times,
    // one time, or more than one time depending on the update rate. the
    // simulation logic always executes with a fixed time step.
    //
    // start out will all of the time from the current tick
    // plus any left over time from the prior tick(s). step
    // at a fixed rate until we have less than one timestep
    // remaining. at each step, we call the simulate callback.
    State.timeAccumulator        += elapsedTime;
    while (State.timeAccumulator >= logicStep)
    {
        simulate(logicStep, State.simulationTime);
        State.simulationTime     += logicStep;
        State.timeAccumulator    -= logicStep;
        State.simulationCount    += 1;
    }

    // execute the presentation callback. we do this only if
    // the simulation callback is non-null, which means that
    // we should have valid presentation state data.
    if (State.simulationCount > 0)
    {
        // we may have some unused portion of time remaining
        // in the timeAccumulator variable, which means that
        // what gets presented is not quite up-to-date. the
        // solution is to provide an interpolation factor we
        // can use to interpolate between the last steps'
        // simulation state and the current steps' state. This
        // prevents temporal aliasing from occurring. See:
        // http://gafferongames.com/game-physics/fix-your-timestep/
        var t = State.timeAccumulator / logicStep; // in [0, 1].
        present(elapsedTime, currentTime, t);
    }
}

/// Callback invoked when the global window object raises the 'load' event
/// to indicate that all page content (scripts, images, CSS, etc.) have been
/// loaded and are available for use.
function window_Load()
{
    window.removeEventListener('load', window_Load);
    start();
}

/// Callback invoked when the global document object raises the
/// 'DOMContentLoaded' event to indicate that DOM has been parsed and can be
/// accessed and manipulated by JavaScript code.
function document_Load()
{
    document.removeEventListener('DOMContentLoaded', document_Load);
    init();
}
window.addEventListener('load', window_Load);
document.addEventListener('DOMContentLoaded', document_Load);
