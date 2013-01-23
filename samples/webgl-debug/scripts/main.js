/*/////////////////////////////////////////////////////////////////////////////
/// @summary Implements the entry point of a real-time JavaScript application.
/// This sample uses webgl.js to render sprites in screen-space.
/// @author Russell Klenk (russ@ninjabirdstudios.com)
///////////////////////////////////////////////////////////////////////////80*/
/// An object storing the global application state.
var State                     = {
    /// The handle returned by window.requestAnimationFrame.
    updateHandle              : 0,
    /// The DOM element monitored by window.requestAnimationFrame.
    domElement                : null,
    /// The DOM image element containing our texture data.
    domImage                  : null,
    /// The WebGL rendering context.
    webglContext              : null,
    /// The WebGL viewport descriptor.
    viewport                  : null,
    /// The combined model-view-projection matrix.
    transform                 : new Float32Array(16),
    /// An array of WebGL vertex attribute descriptors.
    attributes                : null,
    /// An array of vertex buffer object proxies corresponding to attributes.
    buffers                   : null,
    /// The WebGL vertex buffer object proxy.
    indexBuffer               : null,
    /// The WebGL index buffer object proxy.
    vertexBuffer              : null,
    /// The WebGL texture object proxy for our loaded texture.
    texture                   : null,
    /// The WebGL program object proxy.
    program                   : null
};

/// Constants representing limit values.
/// request rate here.
var Constants                 = {
    /// The frame request rate of 60 frames per-second.
    FRAME_REQUEST_RATE        : 1000.0 / 60.0
};

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

function webGL_ContextLost(context)
{
    console.log('Rendering context was lost.');
}

function webGL_ContextRestored(context)
{
    console.log('Rendering context was restored.');
}

function webGL_CompileError(context, stage, sourceCode, log)
{
    console.log('Error compiling shader program:');
    console.log('Message: '+log);
    console.log('Source:  '+sourceCode);
}

function webGL_LinkerError(context, stage, sourceCode, log)
{
    console.log('Error linking shader program:');
    console.log('Message: '+log);
    console.log('Source:  '+sourceCode);
}

function mat4x4_2d(dst16, width, height)
{
    var sX    = 1.0 / (width   * 0.5);
    var sY    = 1.0 / (height  * 0.5);
    dst16[0]  = sX;  dst16[1]  = 0.0;  dst16[2]  = 0.0;  dst16[3]  = 0.0;
    dst16[4]  = 0.0; dst16[5]  = -sY;  dst16[6]  = 0.0;  dst16[7]  = 0.0;
    dst16[8]  = 0.0; dst16[9]  = 0.0;  dst16[10] = 1.0;  dst16[11] = 0.0;
    dst16[12] =-1.0; dst16[13] = 1.0;  dst16[14] = 0.0;  dst16[15] = 1.0;
    return dst16;
}

function createResources()
{
    var gc      = State.webglContext;
    var attribs = [
        WebGL.createAttribute('aPOS', 'FLOAT',          0, 2, false),
        WebGL.createAttribute('aTEX', 'FLOAT',          8, 2, false),
        WebGL.createAttribute('aCLR', 'UNSIGNED_BYTE', 16, 4,  true)
    ];
    var buffers = [
        State.vertexBuffer, /* aPOS */
        State.vertexBuffer, /* aTEX */
        State.vertexBuffer  /* aCLR */
    ];
    var posData = [
        0.0,    0.0,
        640.0,  0.0,
        640.0, 480.0,
        0.0,   480.0
    ];
    var texData = [
        0.0,    0.0,
        1.0,    0.0,
        1.0,    1.0,
        0.0,    1.0
    ];
    var clrData = [ /* RGBA */
        0xFF, 0x00, 0x00, 0xFF,
        0xFF, 0xFF, 0x00, 0xFF,
        0x00, 0xFF, 0xFF, 0xFF,
        0x00, 0x00, 0xFF, 0xFF
    ];
    var arrays  = [
        posData,
        texData,
        clrData
    ];
    var zipped  = WebGL.interleaveArrays(attribs, arrays, 4);
    // @note: the following *MUST* be a Uint16Array, otherwise
    // WebGL interprets the data as unsigned bytes and you will
    // get INVALID_OPERTATION/outside the bounds of the buffer
    // errors when you call drawElements with UNSIGNED_SHORT.
    var idxData = new Uint16Array([0, 3, 1, 1, 3, 2]);

    // Store the vertex attribute definitions for later.
    State.attributes = attribs;
    State.buffers    = buffers;

    // create the GPU vertex buffer and upload vertex data.
    gc.createBufferResource(State.vertexBuffer, {
        target       : 'ARRAY_BUFFER',
        usage        : 'STATIC_DRAW',
        elementSize  : WebGL.computeBufferStride(attribs),
        elementCount : 4
    });
    gc.uploadArrayBufferData(zipped.buffer);

    // create the GPU index buffer and upload index data.
    gc.createBufferResource(State.indexBuffer,  {
        target       : 'ELEMENT_ARRAY_BUFFER',
        usage        : 'STATIC_DRAW',
        elementSize  : Uint16Array.BYTES_PER_ELEMENT,
        elementCount : 6
    });
    gc.uploadIndexBufferData(idxData);

    // load shader source code; compile and link into a program.
    var vss = loadScriptFromDOM('vert');
    var fss = loadScriptFromDOM('frag');
    gc.createProgramResource(State.program, vss, fss);

    // load a DOM texture and upload it to the GPU.
    State.domImage        = new Image();
    State.domImage.onload = function ()
        {
            var width     = State.domImage.width;
            var height    = State.domImage.height;
            gc.useTextureUnit(0);
            gc.createTextureResource(State.texture, {
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
            gc.uploadTextureFromDOM(State.domImage);
            gc.useProgram(State.program);
            gc.setUniform('uTEX', State.texture);
        };
    State.domImage.crossOrigin = '';
    State.domImage.src         = 'https://lh4.googleusercontent.com/-LdfeQfO3nwk/UNTKgdiSf0I/AAAAAAABpiw/0m6dC3OGjbs/s929/IMG_1126-Edit.jpg';
}

/// Callback invoked when all DOM elements have been loaded. The global State
/// object is initialized here and the WebGL context is created.
function init()
{
    var dom               = document.getElementById('canvas');
    State.domElement      = dom;
    State.domImage        = null;
    State.webglContext    = WebGL.createContext(dom, true, {
        alpha             : true,
        depth             : true,
        stencil           : true,
        antialias         : true,
        premultipliedAlpha: true
    });

    // create resource proxy objects. the GPU resources are created later.
    State.texture         = State.webglContext.createTextureProxy();
    State.program         = State.webglContext.createProgramProxy();
    State.indexBuffer     = State.webglContext.createBufferProxy();
    State.vertexBuffer    = State.webglContext.createBufferProxy();
    State.viewport        = State.webglContext.createViewport(dom);
    State.viewport.near   = 1.0;
    State.viewport.far    = 10000.0;
    State.webglContext.applyViewport(State.viewport);
    mat4x4_2d(State.transform, dom.width, dom.height);

    // install handlers for context lost/restored events.
    State.webglContext.on('context:lost',     webGL_ContextLost);
    State.webglContext.on('context:restored', webGL_ContextRestored);
    State.webglContext.on('compile:error',    webGL_CompileError);
    State.webglContext.on('linker:error',     webGL_LinkerError);

    // load shader programs and create GPU resources.
    createResources();
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
    var gc         = State.webglContext;
    var clearFlags = gl.COLOR_BUFFER_BIT |
                     gl.DEPTH_BUFFER_BIT |
                     gl.STENCIL_BUFFER_BIT;

    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clearDepth(1.0);
    gl.clearStencil(0);
    gl.clear(clearFlags);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);

    gc.useProgram(State.program);
    gc.useBuffer (State.indexBuffer);
    gc.useBuffer (State.vertexBuffer);
    gc.setUniform('uMSS', State.transform);
    gc.enableAttributes(State.attributes, State.buffers);
    gc.drawIndexed(6, 0);
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
    // immediately schedule the next update. this lets us stay as close
    // to 60 Hz as possible if we're forced to use the setTimeout fallback.
    State.updateHandle = requestFrame(frameCallback, State.domElement);
    present(0, 0, 0);
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
