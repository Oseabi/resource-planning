import { describe, it, expect } from "vitest";
import {
  classifyArchiveFile,
  pickPrimaryCv,
  planPersonFiles,
  titleFromFilename,
  sameName,
  phoneKey,
  findKnownPerson,
  type ArchiveFile,
} from "@/lib/cv-folder-import";

const DAY = 86_400;

const file = (name: string, over: Partial<ArchiveFile> = {}): ArchiveFile => {
  const dot = name.lastIndexOf(".");
  return { rel: name, name, ext: dot > 0 ? name.slice(dot).toLowerCase() : "", size: 1000, mtime: 100 * DAY, ...over };
};

const kind = (name: string) => classifyArchiveFile(file(name));

describe("what a file is, from its name", () => {
  // Every name here is the shape of one in the archive, with the person changed.
  it.each([
    ["Tipp Focus - Nomsa Dube.docx", "cv"],
    ["Tipp Focus  - Nomsa Dube CV - EA - Discovery Insure.pdf", "cv"],
    ["RAL 20200525_Nomsa Dube.docx", "cv"],
    ["Nomsa_Dube_CV.docx", "cv"],
    ["sam-cv63-Senior Enterprise Architect.pdf", "cv"],
    ["Nomsa_Dube_Profile.pdf", "cv"],
    ["Updated-CV-Nomsa-D.pdf", "cv"],
    ["TOGAF 8.jpg", "certificate"],
    ["Togaf 9_level2_Attendance_Certificate.pdf", "certificate"],
    ["TT COBIT 5 Certification.pdf", "certificate"],
    ["SABSA Foundation.pdf", "certificate"],
    ["certs copy.pdf", "certificate"],
    ["4. Training certificate.pdf", "certificate"],
    ["TT Certified Certificates.pdf", "certificate"],
    ["B COM Honours.pdf", "qualification"],
    ["Matric_Certificate.pdf", "qualification"],
    ["JH_Senior Certificate.pdf", "qualification"],
    ["BSc_Degree_certificate.pdf", "qualification"],
    ["MCA_Provisional Certificate.pdf", "qualification"],
    ["SAQA_Bsc_Evaluation.pdf", "qualification"],
    ["AllDegrees (2) copy.pdf", "qualification"],
    ["BENG 2008.pdf", "qualification"],
    ["B-Tech IT TUT.pdf", "qualification"],
    ["Hons.pdf", "qualification"],
    ["Nomsa Dube_PMD_Transcript.pdf", "qualification"],
    ["Nomsa ID-RSA (1).pdf", "id_document"],
    ["ID_SM.pdf", "id_document"],
    ["Certified Identity Document - Nomsa Dube.pdf", "id_document"],
    ["Nomsa ID certified.pdf", "id_document"],
    ["00_TFH-POPI-TEM-100 Candidate Consent.pdf", "contract"],
    ["Joburg Water Consent Form - Nomsa Dube.pdf", "contract"],
    ["2. Candidate Information Needed for Submission to Client.pdf", "contract"],
    ["Payslip March.pdf", "payroll"],
    ["Proof of banking.pdf", "payroll"],
    ["Criminal check.pdf", "vetting"],
    ["MIE verification report.pdf", "vetting"],
    ["~$msa Dube.docx", "junk"],
    ["Thumbs.db", "junk"],
    ["Cover Letter - Nomsa Dube - 2025_EA.docx", "unknown"],
    ["Skills Matrix - Enterprise Solution Manager.pdf", "unknown"],
    ["Scan0001.pdf", "unknown"],
  ])("%s is %s", (name, expected) => {
    expect(kind(name)).toBe(expected);
  });

  it("does not read a word that merely contains id as an ID copy", () => {
    expect(kind("Video walkthrough.pdf")).toBe("unknown");
    expect(kind("David Nkosi diploma.pdf")).toBe("qualification");
  });
});

describe("the CV a record is built from", () => {
  it("prefers the company's own template over a newer original", () => {
    const picked = pickPrimaryCv([
      file("Nomsa Dube CV.pdf", { mtime: 300 * DAY }),
      file("Tipp Focus - Nomsa Dube.docx", { mtime: 200 * DAY }),
    ]);
    expect(picked?.name).toBe("Tipp Focus - Nomsa Dube.docx");
  });

  it("takes the newer of two template files", () => {
    const picked = pickPrimaryCv([
      file("Tipp Focus - Nomsa Dube.docx", { mtime: 200 * DAY }),
      file("Tipp Focus - Nomsa Dube 2.docx", { mtime: 201 * DAY }),
    ]);
    expect(picked?.name).toBe("Tipp Focus - Nomsa Dube 2.docx");
  });

  it("takes the Word file over a PDF of it saved the same day", () => {
    const picked = pickPrimaryCv([
      file("Tipp Focus - Nomsa Dube CV.pdf", { mtime: 200 * DAY + 60, size: 5000 }),
      file("Tipp Focus - Nomsa Dube CV.docx", { mtime: 200 * DAY }),
    ]);
    expect(picked?.ext).toBe(".docx");
  });

  it("only falls back to a file the reader cannot open when there is nothing else", () => {
    const doc = file("CV - Nomsa Dube.doc", { mtime: 900 * DAY });
    expect(pickPrimaryCv([doc, file("Nomsa CV.pdf")])?.name).toBe("Nomsa CV.pdf");
    expect(pickPrimaryCv([doc])?.name).toBe("CV - Nomsa Dube.doc");
  });

  it("accepts a document named after the person when nothing says CV", () => {
    const files = [file("4. Nomsa Dube.docx"), file("4. KSM Qualifications.pdf"), file("Cover Letter - Nomsa Dube.docx")];
    expect(pickPrimaryCv(files, "Nomsa Dube")?.name).toBe("4. Nomsa Dube.docx");
    // Without the name there is nothing to go on, so nothing is guessed.
    expect(pickPrimaryCv(files)).toBeNull();
  });

  it("finds nothing in a folder of paperwork", () => {
    const files = [file("Interfront Consent Form.pdf"), file("Skills Matrix - Enterprise Solution Manager.pdf")];
    expect(pickPrimaryCv(files, "Nomsa Dube")).toBeNull();
  });

  it("ignores an empty file", () => {
    expect(pickPrimaryCv([file("Nomsa CV.docx", { size: 0 })])).toBeNull();
  });
});

describe("what happens to each file", () => {
  const folder = [
    file("Tipp Focus - Nomsa Dube.docx"),
    file("Nomsa_Dube_CV.docx"),
    file("TOGAF Certificate.pdf"),
    file("BTech.pdf"),
    file("ID Copy-file.pdf"),
    file("TFH-POPI-TEM-100 Candidate Consent.pdf"),
    file("Payslip.pdf"),
    file("Scan0001.pdf"),
    file("old degree.doc"),
  ];
  const actions = (include?: Parameters<typeof planPersonFiles>[1]) =>
    Object.fromEntries(planPersonFiles(folder, include).map((p) => [p.file.name, p.decision]));

  it("loads one CV, attaches the evidence, and holds the paperwork back", () => {
    const plan = actions();
    expect(plan["Tipp Focus - Nomsa Dube.docx"]).toEqual({ action: "primary_cv" });
    expect(plan["Nomsa_Dube_CV.docx"]).toMatchObject({ action: "skip", reason: "another version of the CV" });
    expect(plan["TOGAF Certificate.pdf"]).toEqual({ action: "attach", kind: "certificate", title: "TOGAF Certificate" });
    expect(plan["BTech.pdf"]).toMatchObject({ action: "attach", kind: "qualification" });
    expect(plan["ID Copy-file.pdf"]).toMatchObject({ action: "skip" });
    expect(plan["TFH-POPI-TEM-100 Candidate Consent.pdf"]).toMatchObject({ action: "skip" });
    expect(plan["Scan0001.pdf"]).toMatchObject({ action: "skip" });
    expect(plan["old degree.doc"]).toMatchObject({ action: "skip", reason: ".doc format is not accepted by storage" });
  });

  it("attaches ID copies only when asked", () => {
    expect(actions({ include: ["id_document"] })["ID Copy-file.pdf"]).toMatchObject({ action: "attach", kind: "id_document" });
  });

  it("never loads a payslip, whatever is asked for", () => {
    expect(actions({ include: ["payroll", "vetting"] })["Payslip.pdf"]).toMatchObject({ action: "skip" });
  });

  it("accounts for every file", () => {
    expect(planPersonFiles(folder)).toHaveLength(folder.length);
  });
});

describe("titles", () => {
  it("drops the extension, the numbering and the underscores", () => {
    expect(titleFromFilename("4. Training certificate.pdf")).toBe("Training certificate");
    expect(titleFromFilename("Matric_Certificate.pdf")).toBe("Matric Certificate");
    expect(titleFromFilename("TOGAF 9-1 Certificate.pdf")).toBe("TOGAF 9-1 Certificate");
  });
});

describe("recognising somebody already on file", () => {
  const known = [
    { id: "a", full_name: "Nomsa Thandi Dube", email: "Nomsa@Example.co.za", phone: "082 555 0101" },
    { id: "b", full_name: "Sipho Dube", email: null, phone: null },
  ];

  it("matches a name with or without the middle name, in either order", () => {
    expect(sameName("Nomsa Dube", "Nomsa Thandi Dube")).toBe(true);
    expect(sameName("DUBE, Nomsa", "Nomsa Dube")).toBe(true);
  });

  it("does not match on a surname alone", () => {
    expect(sameName("Dube", "Nomsa Dube")).toBe(false);
    expect(sameName("Sipho Dube", "Nomsa Dube")).toBe(false);
  });

  it("compares phone numbers by their last nine digits", () => {
    expect(phoneKey("+27 82 555 0101")).toBe(phoneKey("082-555-0101"));
    expect(phoneKey("12345")).toBeNull();
  });

  it("finds by email first, then phone, then name, and says which", () => {
    expect(findKnownPerson({ full_name: "N Dube", email: "nomsa@example.co.za", phone: null }, known)).toMatchObject({ by: "email" });
    expect(findKnownPerson({ full_name: "N Dube", email: null, phone: "+27825550101" }, known)).toMatchObject({ by: "phone" });
    expect(findKnownPerson({ full_name: "Sipho Dube", email: null, phone: null }, known)).toMatchObject({ by: "name", person: { id: "b" } });
    expect(findKnownPerson({ full_name: "Lerato Mokoena", email: null, phone: null }, known)).toBeNull();
  });
});
