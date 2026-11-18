/**
 * The few pdfkit calls the fake-statement generator uses. pdfkit ships no usable types, and a
 * types-only dependency was not worth adding for a test fixture.
 */
declare module 'pdfkit' {
  interface PDFDocumentOptions {
    size?: string;
    margin?: number;
    compress?: boolean;
    userPassword?: string;
    ownerPassword?: string;
    /** '1.4' RC4-128, '1.7' AES-128, '1.7ext3' AES-256. */
    pdfVersion?: string;
    info?: Record<string, string>;
  }
  interface TextOptions {
    width?: number;
    align?: 'left' | 'right' | 'center';
    lineBreak?: boolean;
  }
  export default class PDFDocument {
    constructor(options?: PDFDocumentOptions);
    on(event: 'data', listener: (chunk: Uint8Array) => void): this;
    on(event: 'end', listener: () => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    font(name: string): this;
    fontSize(size: number): this;
    text(text: string, x: number, y: number, options?: TextOptions): this;
    heightOfString(text: string, options?: TextOptions): number;
    addPage(): this;
    end(): void;
  }
}
