/*/////////////////////////////////////////////////////////////////////////////
/// @summary Implements a 2d rendering system with a WebGL back end.
/// @author Russell Klenk (russ@ninjabirdstudios.com)
///////////////////////////////////////////////////////////////////////////80*/
var WebGLRenderer = (function (exports)
{
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

    /// An object whose fields and methods are useful when generating vertex
    /// data for a batch of quads.
    var QuadVertex = {};

    /// X-axis values for the four corners of a quad. These values are
    /// transformed by the quad attributes to produce the final position.
    QuadVertex.XCornerOffsets = [0.0, 1.0, 1.0, 0.0];

    /// Y-axis values for the four corners of a quad. These values are
    /// transformed by the quad attributes to produce the final position.
    QuadVertex.YCornerOffsets = [0.0, 0.0, 1.0, 1.0];

    /// An array of vertex attribute definitions for a 32-byte vertex consisting
    /// of position and texture packed as a vec4, followed by a ubyte4 ARGB
    /// color value, followed by a vec3 containing the layer depth and two
    /// generic attribute values.
    QuadVertex.PTCG = [
        WebGL.createAttribute('aPTX', 'FLOAT',          0, 4, false), // XYUV
        WebGL.createAttribute('aCLR', 'UNSIGNED_BYTE', 16, 4,  true), // RGBA
        WebGL.createAttribute('aDGG', 'FLOAT',         20, 3, false)  // Zxx
    ];

    /// Generates interleaved vertex data for a batch of quads. Each vertex is
    /// 32 bytes and consists of a position and texture packed together as a
    /// vec4, followed by a ubyte4 ARGB color, followed by a vec3 containing
    /// the layer depth and two unused attributes.
    /// @param view An object used to access the interleaved vertex array. See
    /// the function @a WebGL.createBufferViews().
    /// @param bufferOffset The index of the first vertex to write in @a view.
    /// @param batch The source @a QuadBatch instance.
    /// @param batchOffset The index of the first quad to read in @a batch.
    /// @param quadCount The number of quads to read from the batch.
    QuadVertex.ptcg = function (view, bufferOffset, batch, batchOffset, quadCount)
    {
        var XCO     = QuadVertex.XCornerOffsets;
        var YCO     = QuadVertex.YCornerOffsets;
        var attribs = view.arrayViews;
        var offsets = view.baseOffsets;
        var sizes   = view.sizes;
        var ptx     = attribs[0];              // position+texture, vec4
        var clr     = attribs[1];              // color, ubyte4
        var atr     = attribs[2];              // depth+unused, vec3
        var aop     = offsets[0];              // offset of position/texture
        var aoc     = offsets[1];              // offset of color attribute
        var aoa     = offsets[2];              // offset of generic attributes
        var asp     = sizes[0];                // size of position/texture
        var asc     = sizes[1];                // size of color attribute
        var asa     = sizes[2];                // size of generic attributes
        var aip     =(bufferOffset * asp)+aop; // offset of position/texture
        var aic     =(bufferOffset * asc)+aoc; // offset of color attribute
        var aia     =(bufferOffset * asa)+aoa; // offset of generic attributes
        var order   = batch.order;
        var srcRect = batch.sourceRects;
        var dstRect = batch.targetRects;
        var origin  = batch.originPoint;
        var scale   = batch.scaleFactor;
        var color   = batch.tintColor;
        var angle   = batch.orientation;
        var depth   = batch.depth;
        var st      = 0.0;                // sin(orientation)
        var ct      = 1.0;                // cos(orientation)
        var xc,  yc;                      // normalized origin point
        var xo,  yo;                      // current corner offset X, Y
        var xd,  yd;                      // X, Y on destination rectangle
        var sx,  sy;                      // X, Y of source rectangle
        var sw,  sh;                      // W, H of source rectangle
        var dx,  dy;                      // X, Y of destination rectangle
        var dw,  dh;                      // W, H of destination rectangle
        var su,  sv;                      // U, V texture scale factors
        var ai1, ai2, ai4;                // quad attribute indices
        var a0i, a1i, a2i;                // vertex attribute indices
        var a,x,y,u,v,c,d,g0,g1;          // vertex attribute data
        var cR,cG,cB,cA;                  // extracted bytes for color channels
        for (var i  = batchOffset, n = batchOffset + quadCount; i < n; ++i)
        {
            ai1 = order[i];               // quad attribute element stride = 1
            ai2 = ai1 << 1;               // quad attribute element stride = 2
            ai4 = ai1 << 2;               // quad attribute element stride = 4
            sx  = srcRect[ai4+0];
            sy  = srcRect[ai4+1];
            sw  = srcRect[ai4+2];
            sh  = srcRect[ai4+3];
            dx  = dstRect[ai4+0];
            dy  = dstRect[ai4+1];
            dw  = dstRect[ai4+2];
            dh  = dstRect[ai4+3];
            xc  = origin[ai2+0] / sw;
            yc  = origin[ai2+1] / sh;
            a   = angle[ai1];
            c   = color[ai1];
            cR  = (c >> 24) & 0xFF;
            cG  = (c >> 16) & 0xFF;
            cB  = (c >>  8) & 0xFF;
            cA  = (c >>  0) & 0xFF;
            d   = 1.0 / depth[ai1];      // needs to be mapped to [-1, 1]
            su  = scale[ai2+0];
            sv  = scale[ai2+1];
            st  = Math.sin(angle[ai1]);
            ct  = Math.cos(angle[ai1]);
            g0  = 0.0;
            g1  = 0.0;
            for (var j = 0; j < 4; ++j)
            {
                xo = XCO[j];
                yo = YCO[j];
                xd = (xo -  xc) * dw;
                yd = (yo -  yc) * dh;
                x  = (dx + (xd  * ct)) - (yd * st);
                y  = (dy + (xd  * st)) + (yd * ct);
                u  = (sx + (xo  * sw)) *  su;
                v  = (sy + (yo  * sh)) *  sv;
                ptx[aip+0] = x;
                ptx[aip+1] = y;
                ptx[aip+2] = u;
                ptx[aip+3] = v;
                clr[aic+0] = cR;
                clr[aic+1] = cG;
                clr[aic+2] = cB;
                clr[aic+3] = cA;
                atr[aia+0] = d;
                atr[aia+1] = g0;
                atr[aia+2] = g1;
                aip       += asp;
                aic       += asc;
                aia       += asa;
            }
        }
    };

    /// Generates a indices for an indexed triangle list for a batch of quads.
    /// Each quad consists of two triangles, comprised of four vertices and
    /// six indices.
    /// @param buffer A Uint16Array representing the output buffer.
    /// @param bufferOffset The offset into @a buffer at which to begin writing
    /// index data. This value is specified in indices. The buffer offset
    /// should be incremented by six for each quad output.
    /// @param baseVertex The base vertex index. The vertex index should be
    /// incremented by four for each quad output.
    /// @param quadCount The number of quads being output. The number of
    /// indices generated by this function is six times @a quadCount and the
    /// number of triangles generated is two times @a quadCount.
    function generateIndices(buffer, bufferOffset, baseVertex, quadCount)
    {
        for (var i = 0; i < quadCount; ++i)
        {
            buffer[bufferOffset++] = (baseVertex + 1);
            buffer[bufferOffset++] = (baseVertex + 0);
            buffer[bufferOffset++] = (baseVertex + 2);
            buffer[bufferOffset++] = (baseVertex + 2);
            buffer[bufferOffset++] = (baseVertex + 0);
            buffer[bufferOffset++] = (baseVertex + 3);
            baseVertex            +=  4;
        }
    }

    /// Constructor function for a type representing a unique render method for
    /// batches of screen space quads. Each quad is specified as two triangles.
    /// @param gl The @a WebGL.GLContext interface with the GPU.
    var QuadEffect = function (gl)
    {
        if (!(this instanceof QuadEffect))
        {
            return new QuadEffect(gl);
        }
        this.glContext          = gl;
        this.program            = gl.createProgramProxy();
        this.vertexBuffer       = gl.createBufferProxy();
        this.indexBuffer        = gl.createBufferProxy();
        this.projection         = new Float32Array(16);
        this.currentState       = null; // current per-quad state, opaque to us
        this.blendState         = null; // references a blend state object.
        this.blendStateNone     = null; // from WebGL.createBlendState()
        this.blendStateAlpha    = null; // from WebGL.createBlendState()
        this.blendStateAdditive = null; // from WebGL.createBlendState()
        this.rasterState        = null; // from WebGL.createRasterState()
        this.depthStencilState  = null; // from WebGL.createDepthStencilState()
        this.vertexBuffers      = null; // array of buffer resource proxies
        this.vertexAttributes   = null; // array of vertex attribute descriptors
        this.indexData          = null; // Uint16Array for sys mem indices
        this.vertexData         = null; // ArrayBuffer for sys mem vertices
        this.vertexDataView     = null; // from WebGL.createBufferViews()
        this.vertexCapacity     = 0;    // in vertices
        this.vertexOffset       = 0;    // in vertices
        this.indexCapacity      = 0;    // in indices
        this.indexOffset        = 0;    // in indices
        return this;
    };

    /// Allocates the WebGL resources associated with the render method.
    /// @param vss The vertex shader source code.
    /// @param fss The fragment shader source code.
    /// @param attributes An array of vertex attribute descriptors describing
    /// the desired vertex data format for the render method. See the function
    /// @a WebGL.createAttribute().
    /// @param capacity The desired geometry capacity of the render method
    /// indicating the maximum number of primitives that can be submitted in a
    /// single draw call to the GPU. This value is specified in quads.
    /// @return The QuadEffect.
    QuadEffect.prototype.createResources = function (vss, fss, attributes, capacity)
    {
        var gl  = this.glContext;
        var spo = this.program;
        var vbo = this.vertexBuffer;
        var ibo = this.indexBuffer;

        // create the GPU resources.
        gl.createProgramResource(spo, vss, fss);
        gl.createBufferResource (vbo, {
            target       : 'ARRAY_BUFFER',
            usage        : 'DYNAMIC_DRAW',
            elementSize  : WebGL.computeBufferStride(attributes),
            elementCount : capacity * 4
        });
        gl.createBufferResource (ibo, {
            target       : 'ELEMENT_ARRAY_BUFFER',
            usage        : 'DYNAMIC_DRAW',
            elementSize  : Uint16Array.BYTES_PER_ELEMENT,
            elementCount : capacity * 6
        });

        // create default render states.
        this.blendStateNone     = gl.createBlendState({
            enabled             : false
        });
        this.blendStateAlpha    = gl.createBlendState({
            enabled             : true,
            sourceFactorRGB     : 'SRC_ALPHA',
            sourceFactorAlpha   : 'SRC_ALPHA',
            targetFactorRGB     : 'ONE_MINUS_SRC_ALPHA',
            targetFactorAlpha   : 'ONE_MINUS_SRC_ALPHA',
            functionRGB         : 'FUNC_ADD',
            functionAlpha       : 'FUNC_ADD'
        });
        this.blendStateAdditive = gl.createBlendState({
            enabled             : true,
            sourceFactorRGB     : 'SRC_ALPHA',
            sourceFactorAlpha   : 'SRC_ALPHA',
            targetFactorRGB     : 'ONE',
            targetFactorAlpha   : 'ONE',
            functionRGB         : 'FUNC_ADD',
            functionAlpha       : 'FUNC_ADD'
        });
        this.blendState         = this.blendStateNone;
        this.rasterState        = gl.createRasterState({
            cullingEnabled      :  true,
            cullFace            : 'BACK',
            windingOrder        : 'CCW'
        });
        this.depthStencilState  = gl.createDepthStencilState({
            depthWriteEnabled   : true,
            depthTestEnabled    : false,
            stencilTestEnabled  : false
        });

        // create the system memory resources.
        var svb = new ArrayBuffer(vbo.totalSize);
        var sib = new Uint16Array(capacity * 6);
        var vba = new Array(attributes.length);
        this.indexData        = sib;
        this.vertexData       = svb;
        this.vertexBuffers    = vba;
        this.vertexDataView   = WebGL.createBufferViews(svb, attributes);
        this.vertexAttributes = attributes;
        this.vertexCapacity   = capacity * 4;
        this.indexCapacity    = capacity * 6;
        this.vertexOffset     = 0;
        this.indexOffset      = 0;

        // map each vertex attribute to its source buffer resource proxy.
        // all attributes map to the same vertex array.
        for (var i = 0, n = vba.length; i < n; ++i)
            vba[i] = vbo;

        return this;
    };

    /// Deletes the WebGL resources associated with the render method.
    /// @return The QuadEffect.
    QuadEffect.prototype.deleteResources = function ()
    {
        var gl = this.glContext;
        gl.deleteBufferResource(this.indexBuffer);
        gl.deleteBufferResource(this.vertexBuffer);
        gl.deleteProgramResource(this.program);
        this.indexData      = null;
        this.vertexData     = null;
        this.vertexDataView = null;
        this.vertexCapacity = 0;
        this.vertexOffset   = 0;
        this.indexCapacity  = 0;
        this.indexOffset    = 0;
        return this;
    };

    /// Constructs a projection matrix that can be used for rendering in
    /// screen space pixel coordinates.
    /// @param width The viewport width, in pixels.
    /// @param height The viewport height, in pixels.
    /// @return A 16-element Float32Array representing a 4x4 projection matrix.
    QuadEffect.prototype.applyViewport = function (width, height)
    {
        var dst16 = this.projection;
        var sX    = 1.0 / (width   * 0.5);
        var sY    = 1.0 / (height  * 0.5);
        dst16[0]  = sX;  dst16[1]  = 0.0;  dst16[2]  = 0.0;  dst16[3]  = 0.0;
        dst16[4]  = 0.0; dst16[5]  = -sY;  dst16[6]  = 0.0;  dst16[7]  = 0.0;
        dst16[8]  = 0.0; dst16[9]  = 0.0;  dst16[10] = 1.0;  dst16[11] = 0.0;
        dst16[12] =-1.0; dst16[13] = 1.0;  dst16[14] = 0.0;  dst16[15] = 1.0;
        return dst16;
    };

    /// Performs any one-time setup for the render method prior to submitting
    /// draw calls. Per-quad state changes should be handled elsewhere.
    /// @param setupProgram A function with the signature:
    /// function (effect, GLContext, programProxy, float32ProjectionMatrix)
    /// This function should perform any custom setup for the effect. The
    /// buffer resources and program are bound at call time.
    QuadEffect.prototype.makeCurrent = function (setupProgram)
    {
        var gl = this.glContext;
        gl.useProgram(this.program);
        gl.useBuffer (this.indexBuffer);
        gl.useBuffer (this.vertexBuffer);
        gl.enableAttributes(this.vertexAttributes, this.vertexBuffers);
        gl.applyBlendState (this.blendState);
        gl.applyRasterState(this.rasterState);
        gl.applyDepthStencilState(this.depthStencilState);
        setupProgram(this, gl, this.program, this.projection);
        this.currentState = null;
        return this;
    };

    /// Generates vertex and index data and updates both system and GPU memory
    /// buffers. Buffers act as circular buffers. If the end of the buffers is
    /// reached, as much data as possible is buffered.
    /// @param batch The @a QuadBatch being uploaded.
    /// @param offset The offset into @a batch specified in quads.
    /// @param count The number of quads to upload.
    /// @param generateVertices A callback function with the signature:
    /// function (view, viewOffsetVerts, batch, batchOffsetQuads, countQuads)
    /// @return The number of quads buffered. If less than @a count, the end of
    /// the buffer was reached. Call the function again to buffer the remainder.
    QuadEffect.prototype.bufferData = function (batch, offset, count, generateVertices)
    {
        var numIndices   = count * 6;
        var numVertices  = count * 4;
        var baseIndex    = this.indexOffset;
        var baseVertex   = this.vertexOffset;
        var maxIndices   = this.indexCapacity;
        var maxVertices  = this.vertexCapacity;
        if (maxVertices  < baseVertex + numVertices)
        {
            // there isn't enough space in the buffer to fit everything.
            // only a portion of the desired data will be uploaded.
            numVertices  = maxVertices - baseVertex;
            numIndices   = maxIndices  - baseIndex;
        }

        var gl           = this.glContext;
        var indexData    = this.indexData.buffer; // @note: ArrayBuffer
        var indexBuffer  = this.indexBuffer;
        var indexSize    = indexBuffer.elementSize;
        var vertexData   = this.vertexData;
        var vertexView   = this.vertexDataView;
        var vertexBuffer = this.vertexBuffer;
        var vertexSize   = vertexBuffer.elementSize;
        var quadCount    = numVertices / 4;
        if (quadCount  === 0) return 0;

        // update our system memory buffers.
        // @note: we pass this.indexData explicitly as it is a Uint16Array.
        generateVertices(vertexView, baseVertex, batch, offset, quadCount);
        generateIndices(this.indexData, baseIndex, baseVertex, quadCount);

        // upload the data to the GPU buffers from system memory.
        // @note: this.indexData is a Uint16Array, but we need to
        // upload a portion of the Uint16Array. So the source is
        // the ArrayBuffer that lies underneath this.indexData,
        // cached in our (local) indexData variable. We create a
        // new Uint16Array representing the portion to be uploaded.
        // the mixing of bytes and elements all over the place is
        // not straightforward at all; it's easy to get wrong and
        // end up uploading the wrong region or having your index
        // data come out as all zeroes. crappy API design...
        var offsetVB = baseVertex * vertexSize;      // byte offset
        var amountVB = quadCount  * vertexSize  * 4; // size in bytes
        var offsetIB = baseIndex  * indexSize;       // byte offset
        var amountIB = quadCount  * 6;               // size in uint16_t
        var regionVB = new Uint8Array(vertexData, offsetVB, amountVB);
        var regionIB = new Uint16Array(indexData, offsetIB, amountIB);
        gl.uploadArrayBufferRegion(offsetVB, regionVB);
        gl.uploadIndexBufferRegion(offsetIB, regionIB);
        this.indexOffset  += quadCount * 6;
        this.vertexOffset += quadCount * 4;
        if (maxVertices  === this.vertexOffset)
        {
            this.indexOffset  = 0;
            this.vertexOffset = 0;
        }
        return quadCount;
    };

    /// Renders a portion of a quad batch for which the vertex and index data
    /// has already been buffered. State changes within the sub-batch are
    /// applied as necessary.
    /// @param batch The @a QuadBatch being rendered.
    /// @param offset The zero-based index of the first quad in the batch.
    /// @param count The number of quads to render.
    /// @param baseIndex The offset within the index buffer, in indices.
    /// @param applyState A function with signature:
    /// function (effect, gl, program, state)
    /// Called to to apply per-quad state by setting samplers, etc.
    /// @return The QuadEffect.
    QuadEffect.prototype.drawRegion = function (batch, offset, count, baseIndex, applyState)
    {
        var gl     = this.glContext;
        var shader = this.program;
        var state0 = this.currentState;
        var state1 = this.currentState;
        var order  = batch.order;
        var state  = batch.state;
        var index  = 0; // index of start of sub-batch
        var nquad  = 0; // number of quads in sub-batch
        var nindex = 0; // number of indices in sub-batch
        var quadId = 0; // quad insertion index
        for (var i = 0; i < count; ++i)
        {
            quadId = order[i];
            state1 = state[quadId];
            if (state1 !== state0)
            {
                // render the previous sub-batch with the current state.
                if (i > index)
                {   // ...as long as it has at least one quad in it.
                    nquad  = i - index; // number of quads being submitted
                    nindex = nquad * 6; // number of indices being submitted
                    gl.drawIndexed(nindex, baseIndex);
                    baseIndex += nindex;
                }
                // now apply the new state and start a new sub-batch.
                applyState(this, gl, shader, state1);
                state0 = state1;
                index  = i;
            }
        }
        // submit the remainder of the sub-batch.
        nquad  = count - index;
        nindex = nquad * 6;
        gl.drawIndexed(nindex, baseIndex);
        this.currentState = state1;
        return this;
    };

    /// Submits an entire batch of quads for rendering. Geometry data is
    /// buffered as necessary.
    /// @param batch The @a QuadBatch to render.
    /// @param generateVertices A callback function with the signature:
    /// function (view, viewOffsetVerts, batch, batchOffsetQuads, countQuads)
    /// @param applyState A function with signature:
    /// function (effect, gl, program, state)
    /// Called to to apply per-quad state by setting samplers, etc.
    /// @return The QuadEffect.
    QuadEffect.prototype.drawBatch = function (batch, generateVertices, applyState)
    {
        var baseIndex    = this.indexOffset;
        var quadCount    = batch.quadCount;
        var quadIndex    = 0;
        var n            = 0;
        while (quadCount > 0)
        {
            // @note: SIDE EFFECTS.
            // drawRegion() updates currentState.
            // bufferData() updates vertexOffset and indexOffset.
            // buffer as much data as we can, render and repeat until done.
            n = this.bufferData(batch, quadIndex, quadCount, generateVertices);
            this.drawRegion(batch, quadIndex, n, baseIndex, applyState);
            baseIndex  = this.indexOffset;
            quadIndex += n;
            quadCount -= n;
        }
        return this;
    };

    /// Constructor function for an objects that maintains the source data for
    /// a batch of 2D screen-aligned quads.
    /// @param capacity The maximum number of quads in the batch. This value is
    /// used to pre-allocate storage and reserve space in vertex and index
    /// buffers managed by the effects used to render the batch.
    /// @return The QuadBatch.
    var QuadBatch = function (capacity)
    {
        if (!(this instanceof QuadBatch))
        {
            return new QuadBatch(capacity);
        }
        capacity          = capacity || 2048;
        this.order        = null; // Uint16Array (capacity * 1), insert order
        this.sourceRects  = null; // Float32Array(capacity * 4), rect XYWH
        this.targetRects  = null; // Float32Array(capacity * 4), rect XYWH
        this.originPoint  = null; // Float32Array(capacity * 2), XY
        this.scaleFactor  = null; // Float32Array(capacity * 2), UV
        this.tintColor    = null; // Uint32Array (capacity * 1), ARGB
        this.orientation  = null; // Float32Array(capacity * 1), radians
        this.depth        = null; // Float32Array(capacity * 1), layer index
        this.state        = null; // JavaScript array of per-quad state
        this.quadCount    = 0;    // number of quads currently in use
        return this.resize(capacity);
    };

    /// The maximum capacity of a quad batch.
    QuadBatch.MAX_CAPACITY = 65536;

    /// Implements a sort comparison function for sorting quads into an order
    /// such that they are rendered back-to-front based on their layer depth
    /// attribute. Quads with the same depth are rendered in insertion order.
    /// @param batch The @a QuadBatch being sorted.
    /// @param ia The insertion order index for the first quad.
    /// @param ib The insertion order index for the second quad.
    /// @returns Negative if quad A is less than B; positive if A is greater
    /// than B or zero if A and B are the same quad.
    QuadBatch.backToFront = function (batch, ia, ib)
    {
        var depth   = batch.depth;
        var depthA  = depth[ia];
        var depthB  = depth[ib];
        if (depthA  < depthB) return +1;
        if (depthA  > depthB) return -1;
        // depth values are the same; use insertion order.
        return ((ia > ib) ? +1 : ((ia < ib) ? -1 : 0));
    };

    /// Implements a sort comparison function for sorting quads into an order
    /// such that they are rendered front-to-back based on their layer depth
    /// attribute. Quads with the same depth are rendered in insertion order.
    /// @param batch The @a QuadBatch being sorted.
    /// @param ia The insertion order index for the first quad.
    /// @param ib The insertion order index for the second quad.
    /// @returns Negative if quad A is less than B; positive if A is greater
    /// than B or zero if A and B are the same quad.
    QuadBatch.frontToBack = function (batch, ia, ib)
    {
        var depth   = batch.depth;
        var depthA  = depth[ia];
        var depthB  = depth[ib];
        if (depthA  < depthB) return -1;
        if (depthA  > depthB) return +1;
        // depth values are the same; use insertion order.
        return ((ia > ib) ? +1 : ((ia < ib) ? -1 : 0));
    };

    /// Resizes the internal storage of the quad batch and re-generates index
    /// data necessary to represent the batch as an indexed triangle list.
    /// @param capacity The maximum number of quads in the batch. This value is
    /// used to pre-allocate storage and reserve space in vertex and index
    /// buffers managed by the effects used to render the batch.
    /// @return The QuadBatch.
    QuadBatch.prototype.resize = function (capacity)
    {
        if (capacity > QuadBatch.MAX_CAPCITY)
            capacity = QuadBatch.MAX_CAPCITY;
        this.order        = new Uint16Array (capacity * 1);
        this.sourceRects  = new Float32Array(capacity * 4);
        this.targetRects  = new Float32Array(capacity * 4);
        this.originPoint  = new Float32Array(capacity * 2);
        this.scaleFactor  = new Float32Array(capacity * 2);
        this.tintColor    = new Uint32Array (capacity * 1);
        this.orientation  = new Float32Array(capacity * 1);
        this.depth        = new Float32Array(capacity * 1);
        this.state        = new Array(capacity);
        this.quadCount    = 0;
        this.quadCapacity = capacity;
        return this.flush();
    };

    /// Queues a quad for later rendering.
    /// @param state Application-defined state data associated with the quad.
    /// @param x The x-coordinate of the upper-left corner, in pixels.
    /// @param y The y-coordinate of the upper-left corner, in pixels.
    /// @param depth The layer depth of the quad.
    /// @param originX The x-coordinate of the point of rotation. (relative to?)
    /// @param originY The y-coordinate of the point of rotation. (relative to?)
    /// @param scaleX The scaling factor to apply along the x-axis (1.0 = 100%).
    /// @param scaleY The scaling factor to apply along the y-axis (1.0 = 100%).
    /// @param orientation The quad orientation, specified in radians. Rotation
    /// is performed about the origin point.
    /// @param color A 32-bit unsigned integer value specifying the RGBA tint
    /// color for the quad, with the following format 0xAARRGGBB.
    /// @param sourceX The x-coordinate of the upper-left corner of the image
    /// data on the source image, in pixels.
    /// @param sourceY The y-coordinate of the upper-left corner of the image
    /// data on the source image, in pixels.
    /// @param sourceWidth The width of the image data, in pixels.
    /// @param sourceHeight The height of the image data, in pixels.
    /// @param imageWidth The full width of the source image, in pixels.
    /// @param imageHeight The full height of the source image, in pixels.
    /// @return The zero-based index of the quad data within the batch.
    QuadBatch.prototype.add = function (state, x, y, depth, originX, originY, scaleX, scaleY, orientation, color, sourceX, sourceY, sourceWidth, sourceHeight, imageWidth, imageHeight)
    {
        var bi = this.quadCount;
        var i4 = bi * 4;
        var i2 = bi * 2;
        var i1 = bi;
        this.sourceRects[i4+0] = sourceX;
        this.sourceRects[i4+1] = sourceY;
        this.sourceRects[i4+2] = sourceWidth;
        this.sourceRects[i4+3] = sourceHeight;
        this.targetRects[i4+0] = x;
        this.targetRects[i4+1] = y;
        this.targetRects[i4+2] = sourceWidth  * scaleX;
        this.targetRects[i4+3] = sourceHeight * scaleY;
        this.originPoint[i2+0] = originX;
        this.originPoint[i2+1] = originY;
        this.scaleFactor[i2+0] = 1.0 / imageWidth;
        this.scaleFactor[i2+1] = 1.0 / imageHeight;
        this.tintColor[i1]     = color;
        this.orientation[i1]   = orientation;
        this.depth[i1]         = depth;
        this.state[i1]         = state;
        this.order[i1]         = bi;
        this.quadCount         = bi + 1;
        return bi;
    };

    /// Flushes the batch, returning it to an empty state.
    /// @return The QuadBatch.
    QuadBatch.prototype.flush = function ()
    {
        this.quadCount = 0;
        return this;
    };

    /// Implements a sift down operation for an in-place heap sort. This is an
    /// internal method used by the batch sorting implementation.
    /// @param s The zero-based index of the start of the range.
    /// @param e The zero-based index of the end of the range.
    /// @param compare A function (QuadBatch, index_a, index_b) that performs
    /// the comparison operation. The return value is a signed integer
    /// conforming to the standard sort behavior. The comparison function uses
    /// the indices to access the attribute arrays of the QuadBatch. To ensure
    /// a stable sort, if all keys are equal, compare the index arguments.
    QuadBatch.prototype.siftDown = function (s, e, compare)
    {
        var    array  = this.order;
        var     temp  = 0;
        var     root  = s;
        while ((root << 1) <= e)
        {
            var child = root << 1;
            if (child < e && compare(this, array[child], array[child+1]) < 0)
                child++;
            if (compare(this, array[root], array[child]) < 0)
            {
                temp         = array[child];
                array[child] = array[root];
                array[root]  = temp;
                root         = child;
            }
            else return;
        }
    };

    /// Implements a heapify operation for an in-place heap sort. This is an
    /// internal method used by the batch sorting implementation.
    /// @param compare A function (QuadBatch, index_a, index_b) that performs
    /// the comparison operation. The return value is a signed integer
    /// conforming to the standard sort behavior. The comparison function uses
    /// the indices to access the attribute arrays of the QuadBatch. To ensure
    /// a stable sort, if all keys are equal, compare the index arguments.
    QuadBatch.prototype.heapify = function (compare)
    {
        var c = this.quadCount;
        var s = c >> 1;
        while  (s >= 0)
        {
            this.siftDown(s--, c - 1, compare);
        }
    };

    /// Implements an in-place heap sort with a user-defined comparison
    /// function. The sort is not stable by default, but can be made stable
    /// with a properly defined comparison function.
    /// @param compare A function (QuadBatch, index_a, index_b) that performs
    /// the comparison operation. The return value is a signed integer
    /// conforming to the standard sort behavior. The comparison function uses
    /// the indices to access the attribute arrays of the QuadBatch. To ensure
    /// a stable sort, if all keys are equal, compare the index arguments.
    QuadBatch.prototype.sort = function (compare)
    {
        this.heapify(compare);
        var    a = this.order;
        var    e = this.quadCount - 1;
        var    t = 0;
        while (e > 0)
        {
            t    = a[0];
            a[0] = a[e];
            a[e] = t;
            this.siftDown(0, --e, compare);
        }
    };

    /// Constructor function for the Renderer2d type. The renderer maintains
    /// the GPU resource lists and state and translates a generic command list
    /// into a set of GPU commands.
    /// @param gl The @a WebGL.GLContext instance used for creating and
    /// modifying GPU resourcess.
    /// @return The Renderer2d instance.
    var Renderer2d = function (gl)
    {
        if (!(this instanceof Renderer2d))
        {
            return new Renderer2d(gl);
        }
        this.glContext = gl;
        return this;
    };

    /// Creates a new QuadEffect instance that can be used for rendering
    /// batches of dynamically-generated quads efficiently.
    /// @return The new @a QuadEffect instance.
    Renderer2d.prototype.createQuadEffect = function ()
    {
        return new QuadEffect(this.glContext);
    };

    /// Creates a new renderer instance using the specified WebGL context.
    /// @param gl The @a WebGL.GLContext instance used for creating and
    /// modifying GPU resources.
    /// @return The new @a Renderer2d instance.
    function createRenderer(gl)
    {
        return new Renderer2d(gl);
    }

    /// Creates a new quad batch instance with the specified capacity.
    /// @param capacity The maximum number of quads that can be specified in
    /// batch. The maximum capacity is 16384. This value is used to pre-allocate
    /// storage and reserve space in vertex and index buffers managed by the
    /// effects used to render the batch.
    /// @return The new @a QuadBatch instance.
    function createQuadBatch(capacity)
    {
        return new QuadBatch(capacity);
    }

    /// Set the functions exported from this module.
    exports.QuadBatch       = QuadBatch;
    exports.QuadEffect      = QuadEffect;
    exports.QuadVertex      = QuadVertex;
    exports.createRenderer  = createRenderer;
    exports.createQuadBatch = createQuadBatch;
    return exports;
}  (WebGLRenderer || {}));
