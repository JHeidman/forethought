const QRCode = require("qrcode");
const path = require("path");

const SIGNUP_URL = "https://forethought-7s4a.vercel.app/signup";
const OUTPUT_PATH = path.join("C:\\Users\\jhber\\Dropbox\\ai projects\\forethought", "forethought-invite-qr.png");

QRCode.toFile(OUTPUT_PATH, SIGNUP_URL, {
  width: 400,
  margin: 2,
  color: {
    dark: "#000000",
    light: "#ffffff",
  },
}, (err) => {
  if (err) {
    console.error("QR generation failed:", err);
  } else {
    console.log(`QR code saved to: ${OUTPUT_PATH}`);
    console.log(`URL: ${SIGNUP_URL}`);
    console.log(`Invite code to share: FORE2025`);
  }
});
