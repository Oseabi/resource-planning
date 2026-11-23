/**
 * Does a person hold the certificate somebody asked for.
 *
 * Recruiters ask by exam code ("MB-500"), CVs mostly write the certificate's
 * name ("Microsoft Certified: Dynamics 365 Finance & Operations Apps Developer
 * Associate"), and some write both. The scoring engine compares whole names,
 * so a bare code never meets a name there; this table is what joins them.
 *
 * Pure and synchronous, no I/O. A hit always carries the person's own
 * wording ("via"), so the chat can show exactly what it matched on.
 */
import { fold, qualityAgainst, buildCandidateIndex, aliasGroupOf } from "@/lib/skill-matching";
import { ALIAS_GROUPS } from "@/lib/skill-aliases";

export interface ExamCode {
  code: string;
  /** The certificate's names, current and retired, as they appear on CVs. */
  names: string[];
}

/** Microsoft role-based exams, the ones tenders in this business ask for by number. */
export const EXAM_CODES: ExamCode[] = [
  { code: "MB-500", names: ["Dynamics 365 Finance and Operations Apps Developer", "Dynamics 365 F&O Apps Developer", "Finance and Operations Apps Developer"] },
  { code: "MB-300", names: ["Dynamics 365 Core Finance and Operations", "Microsoft Dynamics 365: Core Finance and Operations"] },
  { code: "MB-310", names: ["Dynamics 365 Finance Functional Consultant"] },
  { code: "MB-330", names: ["Dynamics 365 Supply Chain Management Functional Consultant"] },
  { code: "MB-700", names: ["Dynamics 365 Finance and Operations Apps Solution Architect", "Finance and Operations Apps Solution Architect"] },
  { code: "MB-800", names: ["Dynamics 365 Business Central Functional Consultant"] },
  { code: "MB-820", names: ["Dynamics 365 Business Central Developer"] },
  { code: "MB-210", names: ["Dynamics 365 Sales Functional Consultant"] },
  { code: "MB-230", names: ["Dynamics 365 Customer Service Functional Consultant"] },
  { code: "MB-240", names: ["Dynamics 365 Field Service Functional Consultant"] },
  { code: "MB-910", names: ["Dynamics 365 Fundamentals (CRM)", "Dynamics 365 Fundamentals Customer Engagement Apps"] },
  { code: "MB-920", names: ["Dynamics 365 Fundamentals (ERP)", "Dynamics 365 Fundamentals Finance and Operations Apps"] },
  { code: "PL-900", names: ["Power Platform Fundamentals"] },
  { code: "PL-100", names: ["Power Platform App Maker"] },
  { code: "PL-200", names: ["Power Platform Functional Consultant"] },
  { code: "PL-300", names: ["Power BI Data Analyst"] },
  { code: "DA-100", names: ["Analyzing Data with Microsoft Power BI"] },
  { code: "PL-400", names: ["Power Platform Developer"] },
  { code: "PL-600", names: ["Power Platform Solution Architect"] },
  { code: "AZ-900", names: ["Azure Fundamentals"] },
  { code: "AZ-104", names: ["Azure Administrator"] },
  { code: "AZ-204", names: ["Azure Developer"] },
  { code: "AZ-305", names: ["Azure Solutions Architect"] },
  { code: "AZ-400", names: ["Azure DevOps Engineer", "DevOps Engineer Expert"] },
  { code: "AZ-500", names: ["Azure Security Engineer"] },
  { code: "AZ-700", names: ["Azure Network Engineer"] },
  { code: "AI-900", names: ["Azure AI Fundamentals"] },
  { code: "AI-102", names: ["Azure AI Engineer"] },
  { code: "DP-900", names: ["Azure Data Fundamentals"] },
  { code: "DP-100", names: ["Azure Data Scientist"] },
  { code: "DP-203", names: ["Azure Data Engineer"] },
  { code: "DP-300", names: ["Azure Database Administrator"] },
  { code: "DP-600", names: ["Fabric Analytics Engineer"] },
  { code: "DP-700", names: ["Fabric Data Engineer"] },
  { code: "SC-900", names: ["Security, Compliance, and Identity Fundamentals"] },
  { code: "SC-100", names: ["Cybersecurity Architect"] },
  { code: "SC-200", names: ["Security Operations Analyst"] },
  { code: "SC-300", names: ["Identity and Access Administrator"] },
  { code: "MS-900", names: ["Microsoft 365 Fundamentals"] },
  { code: "MS-102", names: ["Microsoft 365 Administrator"] },
  { code: "MD-102", names: ["Endpoint Administrator"] },
];

const EXAM_PREFIXES = "MB|PL|AZ|DP|SC|MS|AI|MD|DA";

/** Every exam code written in a piece of text, normalised to "MB-500". */
export function examCodesIn(text: string): string[] {
  const re = new RegExp(`\\b(${EXAM_PREFIXES})\\s*[-‐-―]?\\s*(\\d{3})\\b`, "gi");
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const code = `${m[1].toUpperCase()}-${m[2]}`;
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

/** "MB-500" for "mb 500", or null when the text is not an exam code. */
export function asExamCode(text: string): string | null {
  const codes = examCodesIn(text);
  return codes.length === 1 && fold(text).replace(/[\s-]/g, "") === codes[0].toLowerCase().replace("-", "") ? codes[0] : null;
}

/** The exam behind a certificate's name, for display: "Azure Fundamentals" gives AZ-900. */
export function examFor(name: string): ExamCode | null {
  const code = asExamCode(name);
  if (code) return EXAM_CODES.find((e) => e.code === code) ?? { code, names: [] };
  const f = fold(name);
  return EXAM_CODES.find((e) => e.names.some((n) => fold(n) === f)) ?? null;
}

/** Whether `phrase` appears in `text` as whole words, both already folded. */
function hasPhrase(text: string, phrase: string): boolean {
  if (!phrase) return false;
  return ` ${text} `.includes(` ${phrase} `);
}

export interface CertificateHit {
  held: boolean;
  /** The person's own wording that satisfied it. */
  via: string | null;
}

/**
 * Whether any of a person's certificates (and certificate documents on file)
 * answers what was asked for.
 *
 * An exam code is held when the code itself is written, or one of the exam's
 * names appears as a phrase ("Azure Fundamentals" in "Microsoft Certified:
 * Azure Fundamentals (AZ-900)"). Anything else is held when the scoring
 * engine gives it full credit, or when the request, or another spelling of
 * it from the alias table, appears as whole words ("PMP" in "PMI PMP
 * certified 2019"). The engine alone would miss that last case, because it
 * never looks inside a longer entry for a one-word certificate.
 */
export function holdsCertificate(evidence: string[], wanted: string): CertificateHit {
  const exam = examFor(wanted);
  if (exam) {
    for (const item of evidence) {
      if (examCodesIn(item).includes(exam.code)) return { held: true, via: item };
      const f = fold(item);
      if (exam.names.some((n) => hasPhrase(f, fold(n)))) return { held: true, via: item };
    }
    return { held: false, via: null };
  }

  const engine = qualityAgainst(buildCandidateIndex(evidence), wanted);
  if (engine.credit === 1) return { held: true, via: engine.via };

  const group = aliasGroupOf(wanted);
  const forms = group === null ? [wanted] : [ALIAS_GROUPS[group].canonical, ...ALIAS_GROUPS[group].aliases];
  const phrases = forms.map(fold).filter(Boolean);
  for (const item of evidence) {
    const f = fold(item);
    if (phrases.some((p) => hasPhrase(f, p))) return { held: true, via: item };
  }
  return { held: false, via: null };
}
