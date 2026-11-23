import { describe, expect, it } from "vitest";
import { attachmentSource, contentDisposition, contentTypeFor, cvSource, fileRoute } from "./candidate-files";

describe("candidate files", () => {
  it("prefers the SharePoint item over the storage path", () => {
    expect(cvSource({ cv_drive_id: "d", cv_drive_item_id: "i", cv_file_path: "candidates/x.pdf" })).toEqual({ type: "drive", driveId: "d", itemId: "i" });
    expect(cvSource({ cv_file_path: "candidates/x.pdf" })).toEqual({ type: "storage", path: "candidates/x.pdf" });
    expect(cvSource({ cv_drive_id: "d", cv_drive_item_id: null })).toBeNull();
    expect(attachmentSource({ drive_id: "d", drive_item_id: "i", file_path: null })).toEqual({ type: "drive", driveId: "d", itemId: "i" });
    expect(attachmentSource({ file_path: null })).toBeNull();
  });

  it("builds the app's own route", () => {
    expect(fileRoute("cv", "abc")).toBe("/api/files/cv/abc");
  });

  it("names the file safely for the browser", () => {
    expect(contentTypeFor("CV.PDF")).toBe("application/pdf");
    expect(contentTypeFor("CV.doc")).toBe("application/msword");
    expect(contentTypeFor(null)).toBe("application/octet-stream");
    expect(contentDisposition('Thabo "TJ" Molefe CV.pdf')).toBe(`inline; filename="Thabo TJ Molefe CV.pdf"; filename*=UTF-8''Thabo%20TJ%20Molefe%20CV.pdf`);
    expect(contentDisposition("Zoë.pdf")).toContain('filename="Zo_.pdf"');
  });
});
