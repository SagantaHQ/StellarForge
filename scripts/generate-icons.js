const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const svgPath = path.join(__dirname, "..", "public", "icon.svg");
const svgBuffer = fs.readFileSync(svgPath);

const sizes = [
  { size: 32, name: "favicon-32.png" },
  { size: 180, name: "apple-touch-icon.png" },
  { size: 192, name: "icon-192.png" },
  { size: 512, name: "icon-512.png" },
];

(async () => {
  for (const { size, name } of sizes) {
    const outPath = path.join(__dirname, "..", "public", name);
    await sharp(svgBuffer).resize(size, size).png().toFile(outPath);
    console.log(`Generated ${name} (${size}x${size})`);
  }

  // Generate a maskable icon (with padding so it's not cropped)
  const maskableSize = 512;
  const innerSize = Math.round(maskableSize * 0.7);
  const maskablePath = path.join(__dirname, "..", "public", "icon-maskable-512.png");
  await sharp({
    create: {
      width: maskableSize,
      height: maskableSize,
      channels: 4,
      background: { r: 13, g: 14, b: 17, alpha: 1 },
    },
  })
    .composite([
      {
        input: await sharp(svgBuffer).resize(innerSize, innerSize).toBuffer(),
        gravity: "center",
      },
    ])
    .png()
    .toFile(maskablePath);
  console.log("Generated icon-maskable-512.png");

  // Generate favicon.ico (32x32 PNG wrapped in ICO container)
  const faviconPng = await sharp(svgBuffer).resize(32, 32).png().toBuffer();
  const icoHeader = Buffer.alloc(6);
  icoHeader.writeUInt16LE(0, 0);
  icoHeader.writeUInt16LE(1, 2);
  icoHeader.writeUInt16LE(1, 4);
  const icoEntry = Buffer.alloc(16);
  icoEntry.writeUInt8(32, 0);
  icoEntry.writeUInt8(32, 1);
  icoEntry.writeUInt8(0, 2);
  icoEntry.writeUInt8(0, 3);
  icoEntry.writeUInt16LE(1, 4);
  icoEntry.writeUInt16LE(32, 6);
  icoEntry.writeUInt32LE(faviconPng.length, 8);
  icoEntry.writeUInt32LE(22, 12);
  const icoPath = path.join(__dirname, "..", "public", "favicon.ico");
  fs.writeFileSync(icoPath, Buffer.concat([icoHeader, icoEntry, faviconPng]));
  console.log("Generated favicon.ico");
})();
