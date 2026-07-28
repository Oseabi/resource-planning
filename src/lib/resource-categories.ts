/**
 * Resource categories — a high-level, practice-area grouping for candidates
 * (e.g. "ERP", "Enterprise Architecture (EA)"), above job role and separate
 * from industry sector. A category is *defined by* a cluster of skills / role
 * keywords, so the candidate form can auto-suggest it from what's already been
 * entered. A candidate can hold multiple categories.
 *
 * The stored value on a candidate is an explicit `resource_categories text[]`;
 * this file only provides the curated taxonomy and a pure `deriveCategories`
 * helper used for suggestions (and, later, backfill).
 */

export interface CategoryDef {
  /** Display name and the stored tag value. */
  name: string;
  /** Skill / technology terms that imply this category (case-insensitive substring match). */
  skills: string[];
  /** Role-title keywords that imply this category. */
  roleKeywords?: string[];
}

/**
 * Curated starter taxonomy. Extensible — users can still type their own
 * categories in the form; these just power autocomplete + auto-detect.
 */
export const CATEGORY_DEFS: CategoryDef[] = [
  {
    name: "ERP",
    skills: [
      "d365",
      "dynamics 365",
      "dynamics ax",
      "dynamics nav",
      "business central",
      "sap",
      "oracle ebs",
      "oracle e-business",
      "netsuite",
      "x++",
      "power platform",
      "power apps",
      "f&o",
      "finance and operations",
    ],
    roleKeywords: ["erp", "dynamics", "functional consultant"],
  },
  {
    name: "Enterprise Architecture (EA)",
    skills: [
      "togaf",
      "enterprise architecture",
      "solution architecture",
      "solution architect",
      "zachman",
      "archimate",
    ],
    roleKeywords: ["enterprise architect", "solution architect", "architect"],
  },
  {
    name: "Software Development",
    skills: [
      ".net",
      "c#",
      "java",
      "javascript",
      "typescript",
      "react",
      "angular",
      "vue",
      "node",
      "python",
      "php",
      "ruby",
      "go",
      "spring",
    ],
    roleKeywords: ["developer", "software engineer", "programmer", "full stack", "backend", "frontend"],
  },
  {
    name: "Data & BI",
    skills: [
      "power bi",
      "sql",
      "tableau",
      "etl",
      "data warehouse",
      "data engineering",
      "spark",
      "hadoop",
      "snowflake",
      "analytics",
      "machine learning",
    ],
    roleKeywords: ["data analyst", "data engineer", "data scientist", "bi analyst", "business intelligence"],
  },
  {
    name: "Cloud & DevOps",
    skills: [
      "azure",
      "aws",
      "gcp",
      "kubernetes",
      "docker",
      "terraform",
      "ci/cd",
      "devops",
      "ansible",
      "jenkins",
    ],
    roleKeywords: ["devops", "cloud engineer", "site reliability", "platform engineer"],
  },
  {
    name: "Cybersecurity",
    skills: [
      "cybersecurity",
      "information security",
      "iso 27001",
      "penetration testing",
      "iam",
      "siem",
      "cissp",
      "vulnerability",
    ],
    roleKeywords: ["security", "cyber", "infosec"],
  },
  {
    name: "Project & Programme Management",
    skills: ["pmp", "prince2", "agile", "scrum", "kanban", "programme delivery", "project management"],
    roleKeywords: ["project manager", "programme manager", "program manager", "scrum master", "delivery lead"],
  },
  {
    name: "Business Analysis",
    skills: ["business analysis", "business process analysis", "requirements gathering", "user stories", "bpmn"],
    roleKeywords: ["business analyst", "systems analyst"],
  },
  {
    name: "Finance & Accounting",
    skills: ["accounting", "financial reporting", "ifrs", "tax", "audit", "budgeting", "acca", "cima", "cfa"],
    roleKeywords: ["accountant", "finance manager", "financial analyst", "controller", "bookkeeper"],
  },
  {
    name: "Construction & Engineering",
    skills: ["autocad", "revit", "tekla", "civil engineering", "structural engineering", "quantity surveying", "hse"],
    roleKeywords: ["engineer", "site manager", "quantity surveyor", "foreman", "estimator"],
  },
  {
    name: "Executive & Board",
    skills: ["corporate governance", "strategy", "p&l", "board", "mergers and acquisitions"],
    roleKeywords: ["chief", "ceo", "cfo", "cto", "coo", "director", "head of", "vp", "executive"],
  },
];

/** All category names, in taxonomy order — used for autocomplete + the filter dropdown. */
export const CATEGORY_NAMES: string[] = CATEGORY_DEFS.map((c) => c.name);

export interface DeriveCategoriesInput {
  skills?: string[];
  technical_skills?: string[];
  current_role?: string | null;
  additional_roles?: string[];
}

function includesAny(haystacks: string[], needle: string): boolean {
  const n = needle.toLowerCase();
  return haystacks.some((h) => h.includes(n));
}

/**
 * Suggest resource categories for a candidate from their skills and roles.
 * Case-insensitive substring match against each category's cluster. Returns
 * the matched category names in taxonomy order (no duplicates).
 */
export function deriveCategories(input: DeriveCategoriesInput): string[] {
  const skillTerms = [...(input.skills ?? []), ...(input.technical_skills ?? [])].map((s) =>
    s.toLowerCase(),
  );
  const roleTerms = [input.current_role ?? "", ...(input.additional_roles ?? [])]
    .filter(Boolean)
    .map((r) => r.toLowerCase());

  const matched: string[] = [];
  for (const def of CATEGORY_DEFS) {
    const skillHit = def.skills.some((k) => includesAny(skillTerms, k));
    const roleHit = (def.roleKeywords ?? []).some((k) => includesAny(roleTerms, k));
    if (skillHit || roleHit) matched.push(def.name);
  }
  return matched;
}
