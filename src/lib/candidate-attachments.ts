/**
 * Documents on a person's file: a scanned certificate, a degree, an ID copy, a
 * signed contract. The CV is not one of these. It lives on the candidate row,
 * it is what the TiPP CV is generated from, and a new one replaces it rather
 * than adding to the pile.
 *
 * Six kinds, because that is how somebody looks for one, and because the
 * profile groups under those headings rather than printing eight filenames in
 * upload order. Nothing here expires: a certificate scan is evidence of what
 * somebody holds, not a permission that runs out, and the thing that does run
 * out (a manufacturer's authorisation to resell) is oem-letters.ts.
 *
 * Pure, no I/O, and deliberately free of "server-only": the list and the
 * upload dialog are client components and both read the vocabulary from here.
 */

import type { CandidateAttachmentKind } from "@/lib/supabase/database.types";

/**
 * What a document can be, in the order the profile groups them. The hint is
 * what the upload dialog says under the picker, so the one kind that could be
 * confused with another part of the system says so out loud.
 */
export const ATTACHMENT_KINDS: {
  value: CandidateAttachmentKind;
  label: string;
  /** The group heading on the profile's Documents card. */
  heading: string;
  hint: string;
}[] = [
  {
    value: "certificate",
    label: "Certificate",
    heading: "Certificates",
    hint: "A certification or course certificate, such as a TOGAF or PMP scan.",
  },
  {
    value: "qualification",
    label: "Qualification",
    heading: "Qualifications",
    hint: "A degree, diploma or matric certificate.",
  },
  {
    value: "id_document",
    label: "ID document",
    heading: "ID documents",
    hint: "An ID copy, passport or work permit.",
  },
  {
    value: "contract",
    label: "Contract",
    heading: "Contracts",
    hint: "A signed employment or contractor agreement.",
  },
  {
    value: "reference",
    label: "Reference",
    heading: "References",
    hint: "A written reference about this person. Client reference letters for bids live under Reference letters.",
  },
  {
    value: "other",
    label: "Other",
    heading: "Other documents",
    hint: "Anything else that belongs on this person's file.",
  },
];

const OTHER = ATTACHMENT_KINDS[ATTACHMENT_KINDS.length - 1];

/**
 * Both of these fall back to Other rather than returning the raw value, so a
 * row written by a later migration still reads as something in English.
 */
export function attachmentKindLabel(kind: CandidateAttachmentKind): string {
  return ATTACHMENT_KINDS.find((k) => k.value === kind)?.label ?? OTHER.label;
}

export function attachmentKindHeading(kind: CandidateAttachmentKind): string {
  return ATTACHMENT_KINDS.find((k) => k.value === kind)?.heading ?? OTHER.heading;
}

export function isAttachmentKind(value: unknown): value is CandidateAttachmentKind {
  return ATTACHMENT_KINDS.some((k) => k.value === value);
}

export interface AttachmentGroup<T> {
  kind: CandidateAttachmentKind;
  heading: string;
  items: T[];
}

/**
 * Documents under their headings.
 *
 * Driven by the vocabulary rather than by what arrived, so the headings always
 * read in the same order whatever order the files went in, and a kind with
 * nothing in it produces no heading: an empty "Contracts" label on every
 * profile in the business is noise. Within a group the input order is kept, so
 * the documents read in the order they were attached.
 */
export function groupByKind<T extends { kind: CandidateAttachmentKind }>(
  rows: T[],
): AttachmentGroup<T>[] {
  return ATTACHMENT_KINDS.map(({ value, heading }) => ({
    kind: value,
    heading,
    items: rows.filter((r) => r.kind === value),
  })).filter((g) => g.items.length > 0);
}

/**
 * The certificate names already on the record, for the title field to offer.
 *
 * Kept in the CV's own order rather than sorted, which is where this parts
 * company with folderNames in reference-letters.ts: a CV lists the headline
 * certification first, and alphabetising would bury it behind whatever starts
 * with an A. Duplicates go on a case-insensitive comparison, first spelling
 * winning, since that is the one the CV prints.
 */
export function certificateTitleSuggestions(certificates: { name: string }[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const c of certificates) {
    const name = c.name?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/** The bucket's own limit. Refused here so the person hears why, not by storage. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** The file input's accept list and the guard below, from one place. */
export const ATTACHMENT_ACCEPT = ".pdf,.docx,.png,.jpg,.jpeg";

const ALLOWED_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

/** The last extension of a filename, lowercased. Empty when it has none. */
function extensionOf(filename: string): string {
  const name = filename.trim();
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

/**
 * What is wrong with the chosen file, as the sentence the dialog shows, or
 * null when it is fine. Run in the dialog the moment a file is picked so
 * nobody waits for a round trip to be told, and again in the action, because
 * the dialog's copy is a convenience and not a gate.
 */
export function attachmentFileError(file: { name: string; size: number }): string | null {
  if (file.size <= 0) return "That file is empty. Choose the document you want to attach.";
  if (file.size > MAX_ATTACHMENT_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return `That file is ${mb} MB. Attachments are limited to 10 MB.`;
  }
  const ext = extensionOf(file.name);
  if (!ext) return "That file has no extension, so there is no telling what it is.";
  if (ext === "doc") {
    return "Attach a PDF, a Word .docx, or a PNG or JPEG scan. An old .doc file needs saving as a PDF first.";
  }
  if (!(ext in ALLOWED_TYPES)) {
    return `A .${ext} file cannot be attached. Use a PDF, a Word .docx, or a PNG or JPEG scan.`;
  }
  return null;
}

/**
 * A content type the bucket will actually accept.
 *
 * The bucket enforces allowed_mime_types, so a browser that sends an empty
 * file.type would have the uploader send application/octet-stream, which is
 * not on the list, and storage refuses it with an opaque error. The browser's
 * own type is kept when it is one of the four; otherwise it is derived from
 * the extension.
 */
export function attachmentContentType(filename: string, browserType?: string | null): string {
  const given = browserType?.trim().toLowerCase();
  if (given && Object.values(ALLOWED_TYPES).includes(given)) return given;
  return ALLOWED_TYPES[extensionOf(filename)] ?? "application/octet-stream";
}

/** Where attachments sit in the shared cvs bucket, beside candidates/ and tenders/. */
export const ATTACHMENT_PREFIX = "attachments/";

/** The stored object's path. The uploaded name is kept on the row, not here. */
export function attachmentStoragePath(id: string, filename: string): string {
  return `${ATTACHMENT_PREFIX}${id}.${extensionOf(filename) || "bin"}`;
}
