import { describe, expect, it } from "vitest";
import { toPng, toSvg, toTerminal } from "./qr";

const QR = "2@abc,def,ghi,jkl";

describe("qr", () => {
  it("renders a PNG for agents to show", async () => {
    const png = Buffer.from(await toPng(QR), "base64");
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  });

  it("renders an SVG for the link page", async () => {
    expect(await toSvg(QR)).toMatch(/^<svg/);
  });

  it("renders the terminal's block characters", async () => {
    expect(await toTerminal(QR)).toMatch(/[▀▄█]/);
  });
});
