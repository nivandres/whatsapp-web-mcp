import QRCode from "qrcode";

export async function toPng(qr: string): Promise<string> {
  return (await QRCode.toBuffer(qr, { type: "png", margin: 2, width: 384 })).toString("base64");
}

export function toSvg(qr: string): Promise<string> {
  return QRCode.toString(qr, { type: "svg", margin: 1 });
}

export function toTerminal(qr: string): Promise<string> {
  return QRCode.toString(qr, { type: "terminal", small: true });
}
