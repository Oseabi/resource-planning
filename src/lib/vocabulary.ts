/**
 * Multi-industry vocabulary for a general resourcing platform.
 *
 * Two uses:
 *  1. Autocomplete + quick-add chips on candidate / job / tender forms
 *     (freeform, users can type anything; these are just suggestions).
 *  2. Dictionary matching + skill classification for the free local extraction
 *     engine (technical vs professional skills, role/sector detection).
 *
 * Organised into domain "packs" so suggestions can adapt to a candidate's
 * primary role / sectors (a developer sees dev skills, a PM sees PM skills).
 */

export interface VocabularyPack {
  id: string;
  label: string;
  /** Keywords that link a role/sector string to this pack (lowercased match). */
  keywords: string[];
  roles: string[];
  technicalSkills: string[];
  skills: string[];
  certifications: string[];
  sectors: string[];
}

const softwarePack: VocabularyPack = {
  id: "software",
  label: "Software & IT",
  keywords: [
    "developer",
    "engineer",
    "software",
    "programmer",
    "devops",
    "data",
    "web",
    "full stack",
    "frontend",
    "backend",
    "it",
    "cloud",
    "qa",
    "sre",
    "architect",
    "consultant",
    "erp",
    "analyst",
  ],
  roles: [
    "Software Developer",
    "Software Engineer",
    "Frontend Developer",
    "Backend Developer",
    "Full Stack Developer",
    "Mobile Developer",
    "DevOps Engineer",
    "Site Reliability Engineer",
    "Cloud Engineer",
    "Data Engineer",
    "Data Scientist",
    "Data Analyst",
    "Machine Learning Engineer",
    "QA Engineer",
    "Test Automation Engineer",
    "Solutions Architect",
    "Software Architect",
    "ERP Consultant",
    "Functional Analyst",
    "Systems Analyst",
    "Business Analyst",
    "Database Administrator",
    "Security Engineer",
    "Engineering Manager",
    "Technical Lead",
    "Scrum Master",
    "Product Manager",
  ],
  technicalSkills: [
    "JavaScript",
    "TypeScript",
    "Python",
    "Java",
    "C#",
    "C++",
    "Go",
    "Rust",
    "Ruby",
    "PHP",
    "Swift",
    "Kotlin",
    "SQL",
    "R",
    "X++",
    "React",
    "Next.js",
    "Vue",
    "Angular",
    "Node.js",
    "Express",
    "Django",
    "Flask",
    "Spring",
    ".NET",
    "Ruby on Rails",
    "React Native",
    "Flutter",
    "HTML/CSS",
    "Tailwind CSS",
    "MERN Stack",
    "GraphQL",
    "REST APIs",
    "PostgreSQL",
    "MySQL",
    "MongoDB",
    "Redis",
    "Supabase",
    "Firebase",
    "AWS",
    "Azure",
    "Google Cloud",
    "Docker",
    "Kubernetes",
    "Terraform",
    "CI/CD",
    "Git",
    "Linux",
    "Microsoft Dynamics 365 F&O",
    "D365 Configuration",
    "Power BI",
    "Tableau",
    "Vercel",
    "RLS",
    "Microsoft Office 365",
    // Enterprise / ERP / architecture tooling and frameworks
    "SAP",
    "SAP S/4HANA",
    "SAP ECC",
    "SAP GRC",
    "SAP BusinessObjects",
    "SuccessFactors",
    "Oracle E-Business Suite",
    "NetSuite",
    "TOGAF",
    "ArchiMate",
    "LeanIX",
    "COBIT",
    "ITIL",
    "SAFe",
    "Scrum",
    "Kanban",
    "Azure DevOps",
    "JIRA",
    "Confluence",
    "MS Project",
    "ServiceNow",
    "Sharepoint",
    "Visio",
  ],
  skills: [
    "Business Process Analysis",
    "Functional Specification Writing",
    "Requirements Gathering",
    "ERP System Migration",
    "BPM Documentation",
    "UAT",
    "System Integration",
    "Technical Documentation",
    "Agile Delivery",
    "Code Review",
    "Mentoring",
  ],
  certifications: [
    "Microsoft Certified: Azure Fundamentals",
    "Microsoft Certified: Dynamics 365 F&O Apps Developer Associate",
    "AWS Certified Solutions Architect",
    "AWS Certified Developer",
    "Google Professional Cloud Architect",
    "Certified Kubernetes Administrator",
    "CompTIA Security+",
    "Certified ScrumMaster (CSM)",
    "PMP",
    "ITIL Foundation",
  ],
  sectors: ["Technology", "Software", "Fintech", "Public Sector", "Telecommunications", "E-commerce"],
};

const projectPack: VocabularyPack = {
  id: "project-management",
  label: "Project & Programme Management",
  keywords: ["project", "programme", "program", "delivery", "pmo", "scrum", "agile", "product owner"],
  roles: [
    "Project Manager",
    "Senior Project Manager",
    "Programme Manager",
    "Project Coordinator",
    "PMO Analyst",
    "Product Owner",
    "Scrum Master",
    "Delivery Manager",
    "Portfolio Manager",
    "Change Manager",
  ],
  technicalSkills: ["MS Project", "Primavera P6", "Jira", "Confluence", "Asana", "Monday.com", "Smartsheet"],
  skills: [
    "Project Management",
    "Programme Management",
    "Stakeholder Management",
    "Risk Management",
    "Budget Management",
    "Scope Management",
    "Scrum / Agile",
    "Waterfall",
    "Change Management",
    "Resource Planning",
    "Vendor Management",
    "Reporting",
  ],
  certifications: ["PMP", "PRINCE2", "PRINCE2 Agile", "Certified ScrumMaster (CSM)", "SAFe Agilist", "MSP", "APM PMQ"],
  sectors: ["Consulting", "Technology", "Construction", "Finance", "Public Sector"],
};

const financePack: VocabularyPack = {
  id: "finance",
  label: "Finance & Accounting",
  keywords: ["finance", "accountant", "accounting", "audit", "tax", "financial", "treasury", "controller", "bookkeep"],
  roles: [
    "Financial Analyst",
    "Accountant",
    "Management Accountant",
    "Financial Controller",
    "Finance Manager",
    "Auditor",
    "Tax Consultant",
    "Bookkeeper",
    "Chief Financial Officer",
    "Treasury Analyst",
    "Credit Analyst",
  ],
  technicalSkills: ["Excel", "SAP FICO", "Oracle Financials", "QuickBooks", "Xero", "Sage", "Power BI", "SQL"],
  skills: [
    "Financial Modelling",
    "Financial Reporting",
    "Budgeting & Forecasting",
    "Management Accounts",
    "Auditing",
    "Tax Compliance",
    "Cost Management",
    "Accounts Payable",
    "Accounts Receivable",
    "Reconciliations",
    "IFRS",
    "GAAP",
  ],
  certifications: ["CA", "ACCA", "CIMA", "CPA", "CFA", "SAICA", "AAT"],
  sectors: ["Finance", "Banking", "Insurance", "Public Sector", "Audit"],
};

const executivePack: VocabularyPack = {
  id: "executive",
  label: "Executive & Board",
  keywords: ["director", "chief", "executive", "board", "head of", "vp", "vice president", "ceo", "cfo", "coo", "cto"],
  roles: [
    "Chief Executive Officer",
    "Chief Operating Officer",
    "Chief Financial Officer",
    "Chief Technology Officer",
    "Managing Director",
    "Executive Director",
    "Non-Executive Director",
    "Board Member",
    "Head of Operations",
    "VP of Engineering",
    "General Manager",
  ],
  technicalSkills: [],
  skills: [
    "Strategic Planning",
    "Corporate Governance",
    "P&L Management",
    "Board Reporting",
    "Business Development",
    "Organisational Leadership",
    "Mergers & Acquisitions",
    "Fundraising",
    "Change Leadership",
    "Stakeholder Engagement",
  ],
  certifications: ["MBA", "IoD Chartered Director", "Company Direction Certificate"],
  sectors: ["Corporate", "Consulting", "Finance", "Technology", "Public Sector"],
};

const marketingPack: VocabularyPack = {
  id: "marketing-sales",
  label: "Marketing & Sales",
  keywords: ["marketing", "sales", "brand", "growth", "content", "seo", "account manager", "bd", "business development"],
  roles: [
    "Marketing Manager",
    "Digital Marketing Specialist",
    "Content Manager",
    "SEO Specialist",
    "Brand Manager",
    "Sales Manager",
    "Account Manager",
    "Business Development Manager",
    "Growth Manager",
    "Social Media Manager",
  ],
  technicalSkills: [
    "Google Analytics",
    "Google Ads",
    "Meta Ads",
    "HubSpot",
    "Salesforce",
    "Mailchimp",
    "SEO Tools",
    "Canva",
    "Adobe Creative Suite",
  ],
  skills: [
    "Digital Marketing",
    "Content Strategy",
    "SEO",
    "Campaign Management",
    "Brand Management",
    "Lead Generation",
    "Account Management",
    "CRM",
    "Copywriting",
    "Market Research",
  ],
  certifications: ["Google Ads Certification", "HubSpot Inbound", "Meta Blueprint", "CIM"],
  sectors: ["Marketing", "Retail", "E-commerce", "Media", "Technology"],
};

const healthcarePack: VocabularyPack = {
  id: "healthcare",
  label: "Healthcare",
  keywords: ["nurse", "doctor", "clinical", "medical", "healthcare", "care", "physio", "pharmacist"],
  roles: [
    "Registered Nurse",
    "Clinical Nurse",
    "Doctor",
    "General Practitioner",
    "Physiotherapist",
    "Pharmacist",
    "Healthcare Assistant",
    "Clinical Manager",
    "Radiographer",
    "Care Manager",
  ],
  technicalSkills: ["EMR Systems", "Epic", "Cerner", "Medical Coding"],
  skills: [
    "Patient Care",
    "Clinical Assessment",
    "Medication Administration",
    "Care Planning",
    "Infection Control",
    "Safeguarding",
    "Clinical Governance",
  ],
  certifications: ["BLS", "ACLS", "NMC Registration", "GMC Registration", "First Aid"],
  sectors: ["Healthcare", "Pharmaceutical", "Public Sector", "Private Care"],
};

const constructionPack: VocabularyPack = {
  id: "construction",
  label: "Construction & Engineering",
  keywords: [
    "engineer",
    "site",
    "construction",
    "civil",
    "structural",
    "quantity surveyor",
    "architect",
    "mep",
    "building",
    "estimator",
    "foreman",
  ],
  roles: [
    "Civil Engineer",
    "Senior Civil Engineer",
    "Structural Engineer",
    "Senior Structural Engineer",
    "Mechanical Engineer",
    "Electrical Engineer",
    "MEP Coordinator",
    "BIM Coordinator",
    "Site Engineer",
    "Site Manager",
    "Project Engineer",
    "Quantity Surveyor",
    "Estimator",
    "Planner",
    "Health & Safety Manager",
    "Design Manager",
    "Bid Manager",
    "Contracts Manager",
    "Foreman",
  ],
  technicalSkills: [
    "AutoCAD",
    "AutoCAD Civil 3D",
    "Revit",
    "Tekla Structures",
    "Navisworks",
    "ETABS",
    "SAP2000",
    "STAAD.Pro",
    "Microstation",
    "BIM",
  ],
  skills: [
    "Structural Analysis",
    "BIM Coordination",
    "Site Management",
    "Site Supervision",
    "Setting Out",
    "Quantity Surveying",
    "Cost Estimation",
    "Temporary Works Design",
    "CDM Regulations",
    "NEC Contracts",
    "JCT Contracts",
    "Risk Assessment",
    "Incident Investigation",
  ],
  certifications: [
    "CSCS",
    "CSCS Gold",
    "SMSTS",
    "SSSTS",
    "CPCS",
    "NEBOSH",
    "IOSH",
    "First Aid at Work",
    "Chartered Engineer (CEng)",
    "PRINCE2",
  ],
  sectors: [
    "Construction",
    "Civil Engineering",
    "Infrastructure",
    "Rail",
    "Highways",
    "Bridges",
    "M&E",
    "Fit Out",
    "Residential",
    "Commercial",
  ],
};

const hrPack: VocabularyPack = {
  id: "hr",
  label: "Human Resources",
  keywords: ["hr", "human resources", "recruit", "talent", "people", "payroll"],
  roles: [
    "HR Manager",
    "HR Business Partner",
    "Talent Acquisition Specialist",
    "Recruiter",
    "People Operations Manager",
    "Payroll Administrator",
    "Learning & Development Manager",
  ],
  technicalSkills: ["Workday", "SAP SuccessFactors", "BambooHR", "ATS Systems"],
  skills: [
    "Recruitment",
    "Employee Relations",
    "Performance Management",
    "Talent Management",
    "Payroll",
    "HR Policy",
    "Onboarding",
    "Compensation & Benefits",
  ],
  certifications: ["CIPD", "SHRM-CP", "PHR"],
  sectors: ["Human Resources", "Consulting", "Corporate", "Public Sector"],
};

const legalPack: VocabularyPack = {
  id: "legal",
  label: "Legal",
  keywords: ["lawyer", "legal", "solicitor", "attorney", "counsel", "paralegal", "compliance"],
  roles: [
    "Solicitor",
    "Attorney",
    "Legal Counsel",
    "Corporate Lawyer",
    "Paralegal",
    "Compliance Officer",
    "Contracts Manager",
    "Legal Advisor",
  ],
  technicalSkills: ["Legal Research Tools", "Contract Management Systems"],
  skills: [
    "Contract Law",
    "Corporate Law",
    "Legal Research",
    "Due Diligence",
    "Compliance",
    "Contract Negotiation",
    "Litigation",
    "Regulatory Affairs",
  ],
  certifications: ["LLB", "LLM", "Admitted Attorney", "Bar Admission"],
  sectors: ["Legal", "Finance", "Corporate", "Public Sector"],
};

const dataDesignPack: VocabularyPack = {
  id: "design",
  label: "Design & Creative",
  keywords: ["designer", "ux", "ui", "creative", "graphic", "product design"],
  roles: [
    "UX Designer",
    "UI Designer",
    "Product Designer",
    "Graphic Designer",
    "UX Researcher",
    "Creative Director",
    "Motion Designer",
  ],
  technicalSkills: ["Figma", "Sketch", "Adobe XD", "Adobe Photoshop", "Adobe Illustrator", "InVision"],
  skills: ["User Research", "Wireframing", "Prototyping", "Design Systems", "Visual Design", "Interaction Design"],
  certifications: ["NN/g UX Certification", "Google UX Design Certificate"],
  sectors: ["Technology", "Media", "E-commerce", "Agency"],
};

export const VOCABULARY_PACKS: VocabularyPack[] = [
  softwarePack,
  projectPack,
  financePack,
  executivePack,
  marketingPack,
  healthcarePack,
  constructionPack,
  hrPack,
  legalPack,
  dataDesignPack,
];

/** Qualifications are degree-style; not strongly pack-specific. */
export const SEED_QUALIFICATIONS: string[] = [
  "BSc Computer Science",
  "BSc Information Systems",
  "BCom Information Systems",
  "BCom Accounting",
  "BEng Civil Engineering",
  "BEng Structural Engineering",
  "BEng Mechanical Engineering",
  "BEng Electrical Engineering",
  "BA",
  "BBA",
  "BCom",
  "BSc",
  "MSc",
  "MBA",
  "MEng",
  "PhD",
  "HND",
  "National Diploma",
  "Higher Certificate",
  "Matric / National Senior Certificate",
];

export const SEED_LANGUAGES: string[] = [
  "English",
  "Afrikaans",
  "Zulu",
  "Xhosa",
  "Sotho",
  "Tswana",
  "French",
  "Portuguese",
  "Spanish",
  "German",
  "Mandarin",
  "Arabic",
  "Swahili",
];

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function collect(key: keyof Pick<VocabularyPack, "roles" | "technicalSkills" | "skills" | "certifications" | "sectors">): string[] {
  return unique(VOCABULARY_PACKS.flatMap((p) => p[key]));
}

/** Flat merged lists across all packs, for freeform autocomplete. */
export const ALL_ROLES = collect("roles");
export const ALL_TECHNICAL_SKILLS = collect("technicalSkills");
export const ALL_SKILLS = collect("skills");
export const ALL_CERTIFICATIONS = collect("certifications");
export const ALL_SECTORS = collect("sectors");

const TECHNICAL_SKILL_SET = new Set(ALL_TECHNICAL_SKILLS.map((s) => s.toLowerCase()));

/** Whether a term is a known technical skill (used by extraction classification). */
export function isKnownTechnicalSkill(term: string): boolean {
  return TECHNICAL_SKILL_SET.has(term.trim().toLowerCase());
}

/**
 * Backward-compatible aggregate used across the app. Includes the new fields so
 * existing importers keep working while gaining multi-industry coverage.
 */
export const VOCABULARY = {
  roles: ALL_ROLES,
  technicalSkills: ALL_TECHNICAL_SKILLS,
  skills: ALL_SKILLS,
  certifications: ALL_CERTIFICATIONS,
  qualifications: SEED_QUALIFICATIONS,
  sectors: ALL_SECTORS,
  languages: SEED_LANGUAGES,
} as const;

export type SuggestionField =
  | "roles"
  | "technical_skills"
  | "skills"
  | "certifications"
  | "qualifications"
  | "sectors"
  | "languages";

export interface SuggestionContext {
  primaryRole?: string | null;
  sectors?: string[];
}

/** Packs relevant to a candidate's primary role / sectors. */
function relevantPacks(ctx: SuggestionContext): VocabularyPack[] {
  const role = (ctx.primaryRole ?? "").toLowerCase();
  const sectors = (ctx.sectors ?? []).map((s) => s.toLowerCase());

  const matched = VOCABULARY_PACKS.filter((pack) => {
    const roleHit =
      role.length > 0 &&
      (pack.keywords.some((k) => role.includes(k)) ||
        pack.roles.some((r) => r.toLowerCase() === role));
    const sectorHit = sectors.length > 0 && pack.sectors.some((s) => sectors.includes(s.toLowerCase()));
    return roleHit || sectorHit;
  });

  return matched;
}

const FIELD_TO_PACK_KEY: Record<
  Exclude<SuggestionField, "qualifications" | "languages">,
  keyof Pick<VocabularyPack, "roles" | "technicalSkills" | "skills" | "certifications" | "sectors">
> = {
  roles: "roles",
  technical_skills: "technicalSkills",
  skills: "skills",
  certifications: "certifications",
  sectors: "sectors",
};

/**
 * Suggestions for the quick-add chips on a tag field. When a primary role / sector
 * is known, returns terms from the matching packs; otherwise a broad general set.
 */
export function suggestionsFor(
  field: SuggestionField,
  ctx: SuggestionContext = {},
  limit = 12,
): string[] {
  if (field === "qualifications") return SEED_QUALIFICATIONS.slice(0, limit);
  if (field === "languages") return SEED_LANGUAGES.slice(0, limit);

  const key = FIELD_TO_PACK_KEY[field];
  const packs = relevantPacks(ctx);

  if (packs.length > 0) {
    const fromPacks = unique(packs.flatMap((p) => p[key]));
    if (fromPacks.length > 0) return fromPacks.slice(0, limit);
  }

  // General fallback: spread a common mix across packs.
  const general = unique(VOCABULARY_PACKS.flatMap((p) => p[key].slice(0, 2)));
  return general.slice(0, limit);
}

/** Full autocomplete list for a field (everything we know). */
export function autocompleteFor(field: SuggestionField): string[] {
  switch (field) {
    case "roles":
      return ALL_ROLES;
    case "technical_skills":
      return ALL_TECHNICAL_SKILLS;
    case "skills":
      return ALL_SKILLS;
    case "certifications":
      return ALL_CERTIFICATIONS;
    case "sectors":
      return ALL_SECTORS;
    case "qualifications":
      return SEED_QUALIFICATIONS;
    case "languages":
      return SEED_LANGUAGES;
  }
}
