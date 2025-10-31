// 简化的 H264 解码器包装
// 使用 Broadway 解码器

class H264Decoder {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.decoder = null;
        this.width = 0;
        this.height = 0;

        this.loadDecoder();
    }

    async loadDecoder() {
        // 动态加载 Broadway 解码器
        const script1 = document.createElement('script');
        script1.src = '/broadway/Decoder.js';
        document.head.appendChild(script1);

        const script2 = document.createElement('script');
        script2.src = '/broadway/YUVCanvas.js';
        document.head.appendChild(script2);

        await new Promise(resolve => {
            script2.onload = resolve;
        });

        // 初始化解码器
        if (typeof Decoder !== 'undefined') {
            this.decoder = new Decoder({
                rgb: true,
                size: { width: 1280, height: 720 }
            });

            this.decoder.onPictureDecoded = (buffer, width, height) => {
                this.renderFrame(buffer, width, height);
            };

            console.log('✅ Broadway decoder loaded');
        } else {
            console.error('❌ Broadway decoder not available');
        }
    }

    decode(data) {
        if (!this.decoder) {
            console.warn('⚠️ Decoder not ready');
            return;
        }

        try {
            this.decoder.decode(data);
        } catch (e) {
            console.error('❌ Decode error:', e);
        }
    }

    renderFrame(buffer, width, height) {
        if (this.width !== width || this.height !== height) {
            this.width = width;
            this.height = height;
            this.canvas.width = width;
            this.canvas.height = height;
            console.log(`📐 Canvas resized to ${width}x${height}`);
        }

        const imageData = this.ctx.createImageData(width, height);
        imageData.data.set(buffer);
        this.ctx.putImageData(imageData, 0, 0);
    }
}

