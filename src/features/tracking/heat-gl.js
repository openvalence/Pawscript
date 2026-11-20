// heat-gl.js -- the tracker view's heat splats drawn in one WebGL2 call (paw-bz1t). The 2D path (blobs.js drawHeat) blitted
// one 64 px sprite per visible point (drawImage x 1024..4096 a frame: the overlay's largest main-thread cost); here each
// sprite's own pixels (the same 2D-canvas gradient, uploaded once per colour into a texture array) are drawn as instanced
// quads, linear filtering, multiplied by the splat's alpha, blended source-over premultiplied: what drawImage does with
// globalAlpha. The caller composites the result exactly as before (dev/perf/blobs-window.mjs compares the pixels).
// heatGL() -> {draw(W, H, splats, spriteOf) -> canvas | null} | null (no WebGL2: the caller keeps the 2D path).

const VS = `#version 300 es
in vec2 c; in vec4 s; in float l;
uniform vec2 size;
out vec3 uv; out float a;
void main() { vec2 p = s.xy + c * s.z; gl_Position = vec4(p.x / size.x * 2.0 - 1.0, 1.0 - p.y / size.y * 2.0, 0.0, 1.0); uv = vec3(c, l); a = s.w; }`;
const FS = `#version 300 es
precision highp float; precision highp sampler2DArray;
uniform sampler2DArray t;
in vec3 uv; in float a; out vec4 o;
void main() { o = texture(t, uv) * a; }`;
const S = 64, LAYERS = 64;   // the 2D path's sprite size; colours held (a theme switch mints new ones: full = start over)

export function heatGL() {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas'), gl = cv.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
  gl.useProgram(pr);
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const cl = gl.getAttribLocation(pr, 'c'), sl = gl.getAttribLocation(pr, 's'), ll = gl.getAttribLocation(pr, 'l');
  gl.enableVertexAttribArray(cl); gl.vertexAttribPointer(cl, 2, gl.FLOAT, false, 0, 0);
  const inst = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, inst);
  gl.enableVertexAttribArray(sl); gl.vertexAttribPointer(sl, 4, gl.FLOAT, false, 20, 0); gl.vertexAttribDivisor(sl, 1);
  gl.enableVertexAttribArray(ll); gl.vertexAttribPointer(ll, 1, gl.FLOAT, false, 20, 16); gl.vertexAttribDivisor(ll, 1);
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, S, S, LAYERS);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D_ARRAY, k, v);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);   // the sprite canvas holds premultiplied pixels: uploaded as they are
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const uSize = gl.getUniformLocation(pr, 'size');
  const layer = new Map();   // sprite canvas -> texture layer
  let buf = new Float32Array(5 * 1024);
  return {
    /** splats [{x, y (0..1), r (frame heights), a, c}], spriteOf(c) -> the 2D path's sprite canvas (64 px). -> the canvas (W x H). */
    draw(W, H, splats, spriteOf) {
      if (gl.isContextLost()) return null;
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      gl.viewport(0, 0, W, H); gl.uniform2f(uSize, W, H);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      if (buf.length < 5 * splats.length) buf = new Float32Array(5 * splats.length);
      if (layer.size > LAYERS - 40) layer.clear();   // a frame uses at most 38 colours (slotOf): never reused mid-frame
      let n = 0;
      for (const s of splats) {
        const sp = spriteOf(s.c);
        if (!sp) continue;
        let l = layer.get(sp);
        if (l === undefined) {
          layer.set(sp, (l = layer.size));
          gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, l, S, S, 1, gl.RGBA, gl.UNSIGNED_BYTE, sp);
        }
        const r = s.r * H, o = 5 * n++;
        buf[o] = s.x * W - r; buf[o + 1] = s.y * H - r; buf[o + 2] = 2 * r; buf[o + 3] = s.a; buf[o + 4] = l;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, inst); gl.bufferData(gl.ARRAY_BUFFER, buf.subarray(0, 5 * n), gl.STREAM_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
      return cv;
    },
  };
}
