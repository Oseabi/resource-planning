import { describe, it, expect } from "vitest";
import {
  ATTACHMENT_KINDS,
  ATTACHMENT_PREFIX,
  attachmentContentType,
  attachmentFileError,
  attachmentKindHeading,
  attachmentKindLabel,
  attachmentStoragePath,
  certificateTitleSuggestions,
  groupByKind,
  isAttachmentKind,
  MAX_ATTACHMENT_BYTES,
} from "@/lib/candidate-attachments";
import type { CandidateAttachmentKind } from "@/lib/supabase/database.types";

const doc = (kind: CandidateAttachmentKind, id: string = kind) => ({ id, kind });
const file = (name: string, size = 2 * 1024 * 1024) => ({ name, size });

describe("ATTACHMENT_KINDS", () => {
  it("offers six kinds in the order the profile groups them", () => {
    expect(ATTACHMENT_KINDS.map((k) => k.value)).toEqual([
      "certificate",
      "qualification",
      "id_document",
      "contract",
      "reference",
      "other",
    ]);
    for (const k of ATTACHMENT_KINDS) {
      expect(k.label.length, k.value).toBeGreaterThan(0);
      expect(k.heading.length, k.value).toBeGreaterThan(0);
      expect(k.hint.length, k.value).toBeGreaterThan(0);
    }
  });

  it("says on the reference kind where client reference letters live", () => {
    // The one kind that could be confused with another part of the system.
    const reference = ATTACHMENT_KINDS.find((k) => k.value === "reference");
    expect(reference?.hint).toMatch(/Reference letters/);
  });
});

describe("attachmentKindLabel and attachmentKindHeading", () => {
  it("names each kind, and reads an unknown one as Other", () => {
    expect(attachmentKindLabel("certificate")).toBe("Certificate");
    expect(attachmentKindLabel("id_document")).toBe("ID document");
    expect(attachmentKindHeading("certificate")).toBe("Certificates");
    expect(attachmentKindHeading("id_document")).toBe("ID documents");
    expect(attachmentKindHeading("other")).toBe("Other documents");
    // A row written by a later migration still reads as something in English.
    expect(attachmentKindLabel("payslip" as CandidateAttachmentKind)).toBe("Other");
    expect(attachmentKindHeading("payslip" as CandidateAttachmentKind)).toBe("Other documents");
  });

  it("refuses anything that is not one of the six", () => {
    for (const k of ATTACHMENT_KINDS) expect(isAttachmentKind(k.value)).toBe(true);
    expect(isAttachmentKind("Certificate")).toBe(false);
    expect(isAttachmentKind("")).toBe(false);
    expect(isAttachmentKind(null)).toBe(false);
    expect(isAttachmentKind(undefined)).toBe(false);
  });
});

describe("groupByKind", () => {
  it("files documents under the headings in vocabulary order, not upload order", () => {
    const groups = groupByKind([doc("other"), doc("certificate"), doc("contract")]);
    expect(groups.map((g) => g.kind)).toEqual(["certificate", "contract", "other"]);
    expect(groups.map((g) => g.heading)).toEqual(["Certificates", "Contracts", "Other documents"]);
  });

  it("keeps the order documents arrived in, inside a group", () => {
    const groups = groupByKind([
      doc("certificate", "togaf"),
      doc("certificate", "itil"),
      doc("certificate", "pmp"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((d) => d.id)).toEqual(["togaf", "itil", "pmp"]);
  });

  it("leaves out a kind with nothing in it", () => {
    // An empty "Contracts" heading on every profile in the business is noise.
    const groups = groupByKind([doc("certificate")]);
    expect(groups.map((g) => g.heading)).toEqual(["Certificates"]);
  });

  it("gives nothing for a file with no documents on it", () => {
    expect(groupByKind([])).toEqual([]);
  });
});

describe("certificateTitleSuggestions", () => {
  it("offers the record's own names, in the CV's order, once each", () => {
    // Not alphabetised: a CV lists the headline certification first, and
    // sorting would bury TOGAF behind whatever starts with an A.
    const names = certificateTitleSuggestions([
      { name: "TOGAF 9 Foundation" },
      { name: "AWS Solutions Architect" },
      { name: "  togaf 9 foundation  " },
      { name: "   " },
      { name: "" },
    ]);
    expect(names).toEqual(["TOGAF 9 Foundation", "AWS Solutions Architect"]);
  });

  it("gives nothing when the record has no certificates", () => {
    expect(certificateTitleSuggestions([])).toEqual([]);
  });
});

describe("attachmentFileError", () => {
  it("passes the types the bucket accepts, whatever the case", () => {
    for (const name of ["scan.pdf", "contract.docx", "id.png", "cert.jpg", "cert.jpeg"]) {
      expect(attachmentFileError(file(name)), name).toBeNull();
    }
    expect(attachmentFileError(file("SCAN.PDF"))).toBeNull();
    expect(attachmentFileError(file("togaf.final.pdf"))).toBeNull();
  });

  it("names the file's own size against the limit", () => {
    const error = attachmentFileError(file("big.pdf", 12 * 1024 * 1024));
    expect(error).toContain("12.0 MB");
    expect(error).toContain("10 MB");
    expect(attachmentFileError(file("just-under.pdf", MAX_ATTACHMENT_BYTES))).toBeNull();
  });

  it("tells somebody with an old .doc what to do about it", () => {
    // The shared cvs bucket does not accept application/msword, so this would
    // otherwise fail at storage with an opaque message.
    expect(attachmentFileError(file("contract.doc"))).toMatch(/saving as a PDF/);
  });

  it("refuses an empty file, an unknown type and a name with no extension", () => {
    expect(attachmentFileError(file("scan.pdf", 0))).toMatch(/empty/);
    expect(attachmentFileError(file("archive.zip"))).toMatch(/\.zip/);
    expect(attachmentFileError(file("scan"))).toMatch(/no extension/);
  });
});

describe("attachmentContentType", () => {
  it("keeps a type the bucket allows", () => {
    expect(attachmentContentType("scan.pdf", "application/pdf")).toBe("application/pdf");
  });

  it("derives one when the browser sends nothing, so storage does not refuse the upload", () => {
    expect(attachmentContentType("SCAN.PDF", "")).toBe("application/pdf");
    expect(attachmentContentType("contract.docx", null)).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(attachmentContentType("cert.jpg")).toBe("image/jpeg");
    expect(attachmentContentType("cert.jpeg")).toBe("image/jpeg");
  });

  it("falls back to a type the bucket refuses, for a file that should not be there", () => {
    expect(attachmentContentType("contract.doc")).toBe("application/octet-stream");
    expect(attachmentContentType("scan")).toBe("application/octet-stream");
  });
});

describe("attachmentStoragePath", () => {
  it("files the object under the attachments prefix, keeping the extension", () => {
    expect(attachmentStoragePath("abc-123", "TOGAF.pdf")).toBe("attachments/abc-123.pdf");
    expect(attachmentStoragePath("abc-123", "scan.final.PDF")).toBe("attachments/abc-123.pdf");
    expect(attachmentStoragePath("abc-123", "scan")).toBe("attachments/abc-123.bin");
    expect(attachmentStoragePath("abc-123", "x.png").startsWith(ATTACHMENT_PREFIX)).toBe(true);
  });
});
