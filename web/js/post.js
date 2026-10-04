/* 后期：描边（Sobel 边缘）、拖影（Feedback）、二值化、反相闪白
 * 场景 → rtScene → 后期着色器（读上一帧）→ fb[cur] → 屏幕
 */
(function () {
  const SF = (window.SF = window.SF || {});

  class Post {
    constructor(renderer) {
      this.renderer = renderer;
      const opts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true };
      this.rtScene = new THREE.WebGLRenderTarget(4, 4, opts);
      this.fb = [new THREE.WebGLRenderTarget(4, 4, opts), new THREE.WebGLRenderTarget(4, 4, opts)];
      this.cur = 0;
      this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this.cam.position.z = 0.5;
      this.u = {
        tScene: { value: null }, tPrev: { value: null }, uRes: { value: new THREE.Vector2(4, 4) },
        uEdge: { value: 0 }, uFeedback: { value: 0.5 }, uThreshold: { value: 0 }, uInvert: { value: 0 },
        uDrift: { value: 0 },
      };
      this.mat = new THREE.ShaderMaterial({
        uniforms: this.u,
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
        fragmentShader: `
          uniform sampler2D tScene, tPrev; uniform vec2 uRes;
          uniform float uEdge, uFeedback, uThreshold, uInvert, uDrift;
          varying vec2 vUv;
          float lum(vec2 uv){ return dot(texture2D(tScene, uv).rgb, vec3(.333)); }
          void main(){
            vec2 px = 1.0 / uRes;
            float c = lum(vUv);
            // Sobel 边缘 → 轮廓线（参考图 5 的描边质感）
            float gx = -lum(vUv+px*vec2(-1,-1)) - 2.*lum(vUv+px*vec2(-1,0)) - lum(vUv+px*vec2(-1,1))
                       +lum(vUv+px*vec2( 1,-1)) + 2.*lum(vUv+px*vec2( 1,0)) + lum(vUv+px*vec2( 1,1));
            float gy = -lum(vUv+px*vec2(-1,-1)) - 2.*lum(vUv+px*vec2(0,-1)) - lum(vUv+px*vec2(1,-1))
                       +lum(vUv+px*vec2(-1, 1)) + 2.*lum(vUv+px*vec2(0, 1)) + lum(vUv+px*vec2(1, 1));
            float e = clamp(length(vec2(gx, gy)), 0., 1.);
            float v = mix(c, e, uEdge);
            // 拖影：上一帧轻微放大后衰减叠加
            vec2 puv = (vUv - .5) * (1.0 - uDrift) + .5;
            float prev = texture2D(tPrev, puv).r;
            v = max(v, prev * uFeedback);
            v = mix(v, step(0.5, v), uThreshold);
            v = mix(v, 1.0 - v, uInvert);
            gl_FragColor = vec4(vec3(v), 1.0);
          }`,
        depthTest: false, depthWrite: false,
      });
      this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
      this.scene = new THREE.Scene();
      this.scene.add(this.quad);
      this.copyMat = new THREE.MeshBasicMaterial({ map: null });
      this.copyScene = new THREE.Scene();
      this.copyScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.copyMat));
    }
    setSize(w, h) {
      const pr = this.renderer.getPixelRatio();
      const W = Math.floor(w * pr), H = Math.floor(h * pr);
      this.rtScene.setSize(W, H);
      this.fb.forEach((t) => t.setSize(W, H));
      this.u.uRes.value.set(W, H);
    }
    render(scene, camera) {
      const r = this.renderer;
      r.setRenderTarget(this.rtScene);
      r.clear();
      r.render(scene, camera);
      const out = this.fb[this.cur], prev = this.fb[1 - this.cur];
      this.u.tScene.value = this.rtScene.texture;
      this.u.tPrev.value = prev.texture;
      r.setRenderTarget(out);
      r.render(this.scene, this.cam);
      this.copyMat.map = out.texture;
      r.setRenderTarget(null);
      r.render(this.copyScene, this.cam);
      this.cur = 1 - this.cur;
    }
  }
  SF.Post = Post;
})();
