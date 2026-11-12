/**
 * Reading a person's folder from the recruitment archive.
 *
 * The archive is a SharePoint library kept as role / person / files: a CV or
 * three, the certificates and degrees behind it, and the paperwork a
 * placement generates (ID copies, consent forms, payslips, checks). Loading it
 * means deciding, for every file, what it is and whether it belongs in the
 * system at all. Those decisions live here, pure and tested, so the script
 * around them is only I/O and the dry run can say exactly what it would do.
 *
 * Two rules worth stating:
 *
 * One CV per person. Folders carry several versions; the record is built from
 * the best one and the rest are listed, not loaded.
 *
 * Sensitive paperwork stays out unless asked for. Every signed-in user can
 * open a candidate's documents, and the system has no use for a payslip or a
 * criminal check. ID copies and signed consent forms are held back by the same
 * default, and named in the report so nothing disappears silently.
 */

import type { CandidateAttachmentKind } from "@/lib/supabase/database.types";

export type ArchiveFileKind =
  | "cv"
  | CandidateAttachmentKind
  | "payroll"
  | "vetting"
  | "junk"
  | "unknown";

export interface ArchiveFile {
  /** Path relative to the person's folder, forward slashes. */
  rel: string;
  name: string;
  /** Lowercased, with the dot. */
  ext: string;
  size: number;
  /** Seconds since the epoch. */
  mtime: number;
}

const has = (n: string, re: RegExp) => re.test(n);

/** What the storage bucket accepts. An old .doc or a .tif is refused there. */
export const STORABLE_EXTENSIONS = new Set([".pdf", ".docx", ".png", ".jpg", ".jpeg"]);
/** What the CV reader can open. */
export const READABLE_CV_EXTENSIONS = new Set([".pdf", ".docx"]);

/**
 * What a file is, from its name.
 *
 * Order matters: a "Candidate Consent Form" is paperwork even though it says
 * candidate, and "Tipp Focus - Name CV.pdf" is a CV even though a certificate
 * might also carry the company's name. Anything not recognised is "unknown"
 * and reported, never guessed into a category.
 */
export function classifyArchiveFile(file: Pick<ArchiveFile, "name" | "ext">): ArchiveFileKind {
  const n = file.name.toLowerCase();
  if (n.startsWith("~$") || n === "desktop.ini" || n === "thumbs.db") return "junk";
  if ([".zip", ".msg", ".htm", ".html", ".ini", ".db", ".url", ".lnk"].includes(file.ext)) return "junk";

  if (has(n, /payslip|pay slip|salary|bank|irp5|tax (clearance|number|cert)|proof of (address|banking|residence)/)) return "payroll";
  if (has(n, /criminal|credit check|\bmie\b|verification|clearance|afiswitch|background/)) return "vetting";
  if (has(n, /consent|popi|\bnda\b|offer|contract|agreement|declaration|questionnaire|information needed/)) return "contract";
  if (has(n, /(^|[^a-z])id([^a-z]|$)|identity|passport|smart ?card|work permit/)) return "id_document";
  if (has(n, /reference|testimonial|recommendation/)) return "reference";

  // A CV before the qualifications, so "CV with certificates" reads as a CV.
  if (has(n, /(^|[^a-z])(cv|resume|curriculum vitae|profile)([^a-z]|$)|tipp ?focus|^ral[ _]|tf-t-r/)) return "cv";

  // A named certification first, then anything that reads as a degree, and
  // only then the bare word: "BSc Degree certificate" and "Matric Certificate"
  // are qualifications, and "certificate" alone would have claimed them.
  if (has(n, /togaf|cobit|itil|prince2?|sabsa|cmmi|scrum|cissp|azure|(^|[^a-z])(pmp|aws)([^a-z]|$)/)) return "certificate";
  if (has(n, /degree|diploma|matric|senior certificate|transcript|qualif|saqa|honou?rs|(^|[^a-z])hons([^a-z]|$)|b[ -]?tech|b[ -]?com|(^|[^a-z])b[ -]?sc([^a-z]|$)|beng|masters|(^|[^a-z])(mba|nqf|mca)([^a-z]|$)|academic|marksheet|provisional/)) return "qualification";
  if (has(n, /certificat|(^|[^a-z])certs?([^a-z]|$)|attendance|accredit/)) return "certificate";

  return "unknown";
}

/** The kinds held back unless the operator names them. */
export const SENSITIVE_KINDS: ArchiveFileKind[] = ["id_document", "contract", "payroll", "vetting"];

/** Never loaded, whatever the operator asks: the system has no use for them. */
export const NEVER_LOADED: ArchiveFileKind[] = ["payroll", "vetting", "junk"];

/**
 * The CV a record is built from.
 *
 * A file on the company's own template first, because it is the version a
 * recruiter already cleaned up and the reader takes it whole; then the newest;
 * then, between two saved the same day, the .docx over the .pdf, since a Word
 * file keeps its tables and a PDF made from it sometimes does not. A CV the
 * reader cannot open (.doc) is only chosen when there is nothing else, so the
 * report can say the person needs entering by hand.
 */
export function pickPrimaryCv(files: ArchiveFile[], personName = ""): ArchiveFile | null {
  let cvs = files.filter((f) => classifyArchiveFile(f) === "cv" && f.size > 0);
  // No file calls itself a CV. A Word or PDF file named after the person
  // ("4. Sean Manyaapelo.docx") is one all the same; the caller still has to
  // find that person's name inside it before trusting it.
  if (cvs.length === 0) {
    const words = nameKey(personName).split(" ").filter((w) => w.length > 2);
    cvs = files.filter((f) => {
      if (f.size === 0 || classifyArchiveFile(f) !== "unknown" || !READABLE_CV_EXTENSIONS.has(f.ext)) return false;
      if (/cover letter|skills matrix/i.test(f.name)) return false;
      const inName = new Set(nameKey(f.name.replace(/\.[^.]+$/, "")).split(" "));
      return words.some((w) => inName.has(w));
    });
  }
  if (cvs.length === 0) return null;
  const rank = (f: ArchiveFile) => [
    READABLE_CV_EXTENSIONS.has(f.ext) ? 1 : 0,
    /tipp ?focus/i.test(f.name) ? 1 : 0,
    // Whole days, so two exports of one document are a tie the format settles.
    Math.floor(f.mtime / 86_400),
    f.ext === ".docx" ? 1 : 0,
    f.size,
  ];
  return [...cvs].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i += 1) if (ra[i] !== rb[i]) return rb[i] - ra[i];
    return a.rel.localeCompare(b.rel);
  })[0];
}

export type FileDecision =
  | { action: "primary_cv" }
  | { action: "attach"; kind: CandidateAttachmentKind; title: string }
  | { action: "skip"; reason: string };

/** A file name as a document title: no extension, no numbering, no underscores. */
export function titleFromFilename(name: string): string {
  const stem = name.replace(/\.[^.]+$/, "");
  return stem
    .replace(/[_]+/g, " ")
    .replace(/^\s*\d+[.)]\s*/, "")
    .replace(/\s+/g, " ")
    .trim() || name;
}

/**
 * What happens to each file in a person's folder.
 *
 * `include` names the sensitive kinds the operator has asked for. Everything
 * skipped carries its reason, because the ledger this produces is the answer
 * to "where did that file go".
 */
export function planPersonFiles(
  files: ArchiveFile[],
  options: { include?: ArchiveFileKind[]; personName?: string } = {},
): { file: ArchiveFile; kind: ArchiveFileKind; decision: FileDecision }[] {
  const include = new Set(options.include ?? []);
  const primary = pickPrimaryCv(files, options.personName);

  return files.map((file) => {
    const kind = classifyArchiveFile(file);
    const decide = (): FileDecision => {
      if (file.size === 0) return { action: "skip", reason: "empty file" };
      if (kind === "junk") return { action: "skip", reason: "not a document" };
      if (primary && file.rel === primary.rel) return { action: "primary_cv" };
      if (kind === "cv") return { action: "skip", reason: "another version of the CV" };
      if (/cover letter/i.test(file.name)) return { action: "skip", reason: "a cover letter, not a record" };
      if (NEVER_LOADED.includes(kind)) return { action: "skip", reason: `${kind} paperwork is never loaded` };
      if (SENSITIVE_KINDS.includes(kind) && !include.has(kind)) {
        return { action: "skip", reason: `${kind.replace("_", " ")} held back by default` };
      }
      if (kind === "unknown") return { action: "skip", reason: "could not tell what this is from its name" };
      if (!STORABLE_EXTENSIONS.has(file.ext)) {
        return { action: "skip", reason: `${file.ext || "this"} format is not accepted by storage` };
      }
      return { action: "attach", kind: kind as CandidateAttachmentKind, title: titleFromFilename(file.name) };
    };
    return { file, kind, decision: decide() };
  });
}

/** A name reduced for comparing: case, spacing, punctuation and order of words ignored. */
export function nameKey(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

/**
 * Whether two names are plausibly one person: every word of the shorter name
 * appears in the longer. "Lucas Maredi" and "Lucas Letsatsi Maredi" are; two
 * people sharing only a surname are not.
 */
export function sameName(a: string, b: string): boolean {
  const wa = nameKey(a).split(" ").filter(Boolean);
  const wb = nameKey(b).split(" ").filter(Boolean);
  if (wa.length < 2 || wb.length < 2) return false;
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  const longSet = new Set(long);
  return short.every((w) => longSet.has(w));
}

/** A phone number as its last nine digits, so +27 82 and 082 compare equal. */
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D+/g, "");
  return digits.length >= 9 ? digits.slice(-9) : null;
}

export interface KnownPerson {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
}

/**
 * The person already in the system that a folder belongs to, if any.
 *
 * Email or phone first, since those are the person; then the name, which is
 * how a folder with no readable CV is matched at all. A name match is weaker,
 * and the report says which it was.
 */
export function findKnownPerson(
  candidate: { full_name: string; email: string | null; phone: string | null },
  known: KnownPerson[],
): { person: KnownPerson; by: "email" | "phone" | "name" } | null {
  const email = candidate.email?.trim().toLowerCase();
  if (email) {
    const hit = known.find((k) => k.email?.trim().toLowerCase() === email);
    if (hit) return { person: hit, by: "email" };
  }
  const phone = phoneKey(candidate.phone);
  if (phone) {
    const hit = known.find((k) => phoneKey(k.phone) === phone);
    if (hit) return { person: hit, by: "phone" };
  }
  const hit = known.find((k) => sameName(k.full_name, candidate.full_name));
  return hit ? { person: hit, by: "name" } : null;
}
