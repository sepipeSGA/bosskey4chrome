/**
 * gen-icons.mjs —— 一次性图标生成脚本（仅用 Node 内置模块，无需任何第三方依赖）。
 *
 * 用法：node tools/gen-icons.mjs
 * 产物：icons/icon{16,32,48,128}.png
 *
 * 图案：深色圆角方块背景 + 白色"眼睛"（两圆相交的透镜形轮廓 + 圆心瞳孔），
 *       眼睛整体旋转 90°（竖立的眼睛）。
 * 实现方式：4x 超采样 + 手写 SDF，再用 node:zlib 的 deflateSync 直接编码 PNG。
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'icons');

/** 需要生成的尺寸 */
const SIZES = [16, 32, 48, 128];
/** 每个输出像素的采样数（4 => 4x4 = 16 个采样点） */
const SUPER_SAMPLE = 4;

/** 背景渐变：上浅下深的深色圆角方块 */
const BG_TOP = [0x24, 0x31, 0x47];
const BG_BOTTOM = [0x11, 0x18, 0x24];
/** 眼睛颜色 */
const EYE_COLOR = [0xff, 0xff, 0xff];
/** 圆角半径（相对尺寸） */
const CORNER_RATIO = 0.22;
/** 透镜外接圆半径与圆心偏移（相对尺寸），决定眼睛的宽高比 */
const LENS_RADIUS_RATIO = 0.2318;
const LENS_OFFSET_RATIO = 0.0982;
/** 眼睛轮廓线宽（相对尺寸） */
const LENS_THICKNESS_RATIO = 0.1;
/** 瞳孔半径（相对尺寸） */
const PUPIL_RADIUS_RATIO = 0.075;
/**
 * 是否把眼睛整体旋转 90°。
 * true 时透镜按"竖立"方向绘制（交换 x/y 后送入 sdLens），瞳孔是圆形，不受影响。
 */
const ROTATE_90 = true;

/* ------------------------------- PNG 编码部分 ------------------------------ */

/** CRC32 查表（延迟构建） */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * 计算 CRC32 校验值。
 * @param {Buffer} buffer 输入数据
 * @returns {number} CRC32
 */
function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * 组装一个 PNG chunk。
 * @param {string} type 四字符类型名
 * @param {Buffer} data chunk 数据
 * @returns {Buffer} 完整 chunk
 */
function makeChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/**
 * 把 RGBA 像素数据编码为 PNG 二进制。
 * @param {number} width 宽
 * @param {number} height 高
 * @param {Buffer} rgba 长度为 width*height*4 的像素数据
 * @returns {Buffer} PNG 文件字节
 */
function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type: None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', deflateSync(raw, { level: 9 })),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* -------------------------------- SDF 部分 --------------------------------- */

/**
 * 圆角矩形的带符号距离（负值表示在内部）。
 * @param {number} x 相对坐标 x
 * @param {number} y 相对坐标 y
 * @param {number} halfW 半宽
 * @param {number} halfH 半高
 * @param {number} radius 圆角半径
 * @returns {number} 带符号距离
 */
function sdRoundBox(x, y, halfW, halfH, radius) {
  const qx = Math.abs(x) - halfW + radius;
  const qy = Math.abs(y) - halfH + radius;
  const mx = Math.max(qx, 0);
  const my = Math.max(qy, 0);
  return Math.hypot(mx, my) + Math.min(Math.max(qx, qy), 0) - radius;
}

/**
 * 透镜形（两圆相交）的带符号距离，负值表示在内部。
 * @param {number} x 相对坐标 x
 * @param {number} y 相对坐标 y
 * @param {number} radius 两圆半径
 * @param {number} offset 两圆心到中心的距离
 * @returns {number} 带符号距离
 */
function sdLens(x, y, radius, offset) {
  const d1 = Math.hypot(x + offset, y);
  const d2 = Math.hypot(x - offset, y);
  return Math.max(d1, d2) - radius;
}

/* -------------------------------- 渲染部分 --------------------------------- */

/**
 * 渲染一个尺寸的图标像素数据。
 * @param {number} size 图标边长（像素）
 * @returns {Buffer} RGBA 像素数据
 */
function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = size * CORNER_RATIO;
  const halfW = size / 2;
  const halfH = size / 2;
  const lensRadius = size * LENS_RADIUS_RATIO;
  const lensOffset = size * LENS_OFFSET_RATIO;
  const halfThickness = (size * LENS_THICKNESS_RATIO) / 2;
  const pupilRadius = size * PUPIL_RADIUS_RATIO;
  const samples = SUPER_SAMPLE * SUPER_SAMPLE;
  const step = 1 / SUPER_SAMPLE;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let bgCoverage = 0;
      let eyeCoverage = 0;

      for (let sy = 0; sy < SUPER_SAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPER_SAMPLE; sx += 1) {
          // 采样点坐标（以图标中心为原点）
          const x = px - size / 2 + (sx + 0.5) * step;
          const y = py - size / 2 + (sy + 0.5) * step;

          if (sdRoundBox(x, y, halfW, halfH, radius) <= 0) {
            bgCoverage += 1;
          }
          // 旋转 90°：交换 x/y 后送入透镜 SDF（等价于把整只眼睛竖过来）
          const lensX = ROTATE_90 ? y : x;
          const lensY = ROTATE_90 ? x : y;
          const lens = sdLens(lensX, lensY, lensRadius, lensOffset);
          const onRing = Math.abs(lens) <= halfThickness;
          const onPupil = Math.hypot(x, y) <= pupilRadius;
          if (onRing || onPupil) {
            eyeCoverage += 1;
          }
        }
      }

      const bgAlpha = bgCoverage / samples;
      const eyeAlpha = eyeCoverage / samples;
      const offset = (py * size + px) * 4;

      if (bgAlpha <= 0) {
        rgba[offset] = 0;
        rgba[offset + 1] = 0;
        rgba[offset + 2] = 0;
        rgba[offset + 3] = 0;
        continue;
      }

      // 背景竖向渐变
      const t = (py + 0.5) / size;
      const bg = [
        BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t,
        BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t,
        BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t,
      ];

      // 白色眼睛叠加在背景之上（最终不透明度沿用背景覆盖率）
      rgba[offset] = Math.round(bg[0] + (EYE_COLOR[0] - bg[0]) * eyeAlpha);
      rgba[offset + 1] = Math.round(bg[1] + (EYE_COLOR[1] - bg[1]) * eyeAlpha);
      rgba[offset + 2] = Math.round(bg[2] + (EYE_COLOR[2] - bg[2]) * eyeAlpha);
      rgba[offset + 3] = Math.round(bgAlpha * 255);
    }
  }

  return rgba;
}

/* --------------------------------- 主流程 ---------------------------------- */

mkdirSync(OUT_DIR, { recursive: true });

for (const size of SIZES) {
  const pixels = renderIcon(size);
  const png = encodePng(size, size, pixels);
  const file = resolve(OUT_DIR, `icon${size}.png`);
  writeFileSync(file, png);
  console.log(`generated ${file} (${png.length} bytes)`);
}

console.log('icons generated.');
