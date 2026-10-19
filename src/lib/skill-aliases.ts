/**
 * The many ways one skill, role or certification gets written down.
 *
 * Matching compared skills as exact text, so a person whose CV says
 * "D365 Finance and Operations" scored zero against a seat asking for
 * "Microsoft Dynamics 365 F&O". Skills are 25 of the 100 points and
 * certifications another 20, so being spelled the other way pushed the right
 * person off the shortlist entirely. This table is what closes that gap.
 *
 * Data only, deliberately: the logic lives in skill-matching.ts, so adding an
 * alias never touches a tested file. It is also plain data rather than a
 * setting in the database, because it has to be importable synchronously by
 * the browser (the breakdown panel re-runs the scorer client-side) and because
 * it changes the meaning of every score, which is a code review, not a form.
 *
 * Three rules, enforced by validateAliases rather than by convention:
 *
 * 1. Never alias a credential to a different grade of itself. CSCS is not
 *    CSCS Gold, PRINCE2 is not PRINCE2 Agile, SAP ECC is not S/4HANA, and
 *    Azure Fundamentals is not Azure Administrator. A bid that claims a grade
 *    the person does not hold is worse than one that misses them.
 * 2. Never include a genuinely ambiguous abbreviation. "SA" is Systems Analyst
 *    as often as Solutions Architect; "MSP" is Managing Successful Programmes
 *    as often as MS Project; bare "ISO" and bare "GRC" say nothing.
 * 3. One form belongs to at most one group. A form in two groups would make
 *    two unrelated things equal, which is a worse bug than the one being fixed.
 *
 * A canonical must be a term the system already knows, the rule inherited from
 * tender-import.ts. Where it was not, it was added to vocabulary.ts in the
 * same change rather than taken as a silent exception.
 *
 * To extend: add a group, canonical first, with a note saying where the
 * spelling was actually seen. The tests fail on a collision or an unknown
 * canonical. Grow it from the backlog that scripts/bench-matching.ts prints,
 * which lists the required terms no candidate matched, rather than from
 * imagination.
 */

export type AliasKind = "technology" | "role" | "certification";

export interface AliasGroup {
  /** The spelling the system prefers, and the one vocabulary.ts carries. */
  canonical: string;
  kind: AliasKind;
  /** Every other way the same thing gets written. */
  aliases: string[];
  /** Where it was seen: a tender, a CV, a client's schedule. */
  note?: string;
}

export const ALIAS_GROUPS: AliasGroup[] = [
  // ---------------------------------------------------------------------
  // Microsoft and ERP. The densest source of misses in this business:
  // every tender spells Dynamics differently.
  // ---------------------------------------------------------------------
  {
    canonical: "Microsoft Dynamics 365 F&O",
    kind: "technology",
    aliases: [
      "D365 F&O",
      "D365 FO",
      "D365 Finance and Operations",
      "Dynamics 365 F&O",
      "Dynamics 365 FO",
      "Dynamics 365 Finance and Operations",
      "MS Dynamics 365 F&O",
      "Microsoft Dynamics 365 Finance and Operations",
      "Dynamics AX",
      "AX 2012",
      "Microsoft Dynamics AX",
      "FinOps",
    ],
    note: "NSF and DCoG tenders; AX 2012 is the predecessor and the same skill in practice",
  },
  {
    // Bare Dynamics 365 is its own thing: it also covers CE and CRM, so it is
    // NOT folded into the F&O group. Containment relates them as a near match.
    canonical: "Dynamics 365",
    kind: "technology",
    aliases: ["D365", "MS Dynamics 365", "Microsoft Dynamics 365", "MS Dynamics"],
  },
  {
    canonical: "Dynamics 365 CRM",
    kind: "technology",
    aliases: ["D365 CRM", "Dynamics 365 CE", "D365 CE", "Dynamics 365 Customer Engagement"],
  },
  {
    canonical: "Dynamics 365 Business Central",
    kind: "technology",
    aliases: ["Business Central", "D365 BC", "Dynamics NAV", "Microsoft Dynamics NAV", "Navision"],
  },
  {
    canonical: "D365 Configuration",
    kind: "technology",
    aliases: ["Dynamics 365 Configuration", "D365 Config"],
  },
  {
    canonical: "Power BI",
    kind: "technology",
    aliases: ["PowerBI", "MS Power BI", "Microsoft Power BI"],
  },
  {
    canonical: "Power Platform Developer",
    kind: "role",
    aliases: ["Power Platform", "PowerPlatform", "MS Power Platform", "Power Apps", "PowerApps"],
  },
  {
    canonical: ".NET",
    kind: "technology",
    aliases: ["dotnet", "dot net", "Microsoft .NET", ".NET Core", "ASP.NET", "ASP .NET"],
  },
  {
    canonical: "SharePoint",
    kind: "technology",
    aliases: ["Share Point", "MS SharePoint", "SharePoint Online", "Microsoft SharePoint"],
    note: "spelled Sharepoint in the vocabulary until this change",
  },
  {
    canonical: "Microsoft Office 365",
    kind: "technology",
    aliases: ["O365", "Office 365", "M365", "Microsoft 365", "MS 365", "Office365"],
  },
  {
    canonical: "Microsoft SQL Server",
    kind: "technology",
    aliases: ["MSSQL", "MS SQL", "MS SQL Server", "SQL Server", "T-SQL", "Transact-SQL"],
  },
  {
    canonical: "Azure DevOps",
    kind: "technology",
    aliases: ["VSTS", "TFS", "Team Foundation Server", "Visual Studio Team Services"],
  },
  {
    canonical: "Azure",
    kind: "technology",
    aliases: ["Microsoft Azure", "MS Azure"],
  },
  {
    canonical: "X++",
    kind: "technology",
    aliases: ["X plus plus", "Xpp"],
  },
  {
    canonical: "BizTalk",
    kind: "technology",
    aliases: ["Microsoft BizTalk", "BizTalk Server"],
    note: "IJS Transversal Hub reference letters",
  },

  // ---------------------------------------------------------------------
  // SAP. Module codes are how a tender writes them and how a CV writes them
  // out in full.
  // ---------------------------------------------------------------------
  {
    canonical: "SAP S/4HANA",
    kind: "technology",
    aliases: ["S/4HANA", "S4HANA", "S4 HANA", "SAP S4", "SAP S/4 HANA", "S/4 HANA"],
  },
  {
    canonical: "SAP ECC",
    kind: "technology",
    aliases: ["ECC", "SAP R/3", "SAP ECC 6.0", "SAP ERP Central Component"],
    note: "not the same as S/4HANA, deliberately a separate group",
  },
  {
    canonical: "SAP FICO",
    kind: "technology",
    aliases: ["SAP FI/CO", "FI/CO", "SAP Finance and Controlling"],
  },
  {
    canonical: "SAP SuccessFactors",
    kind: "technology",
    aliases: ["SuccessFactors", "Success Factors", "SAP SF"],
  },
  {
    canonical: "SAP BusinessObjects",
    kind: "technology",
    aliases: ["BusinessObjects", "Business Objects", "BOBJ", "SAP BO"],
  },
  { canonical: "SAP MM", kind: "technology", aliases: ["SAP Materials Management", "SAP Material Management"] },
  { canonical: "SAP SD", kind: "technology", aliases: ["SAP Sales and Distribution"] },
  { canonical: "SAP HCM", kind: "technology", aliases: ["SAP Human Capital Management"] },
  { canonical: "SAP BW", kind: "technology", aliases: ["SAP Business Warehouse", "SAP BW/4HANA"] },
  { canonical: "SAP ABAP", kind: "technology", aliases: ["ABAP", "SAP ABAP OO", "ABAP Objects"] },
  { canonical: "SAP Basis", kind: "technology", aliases: ["Basis", "SAP BASIS Administration"] },
  { canonical: "SAP ISU", kind: "technology", aliases: ["ISU", "SAP IS-U", "SAP Industry Solution Utilities"] },

  // ---------------------------------------------------------------------
  // Cloud, infrastructure and integration
  // ---------------------------------------------------------------------
  { canonical: "AWS", kind: "technology", aliases: ["Amazon Web Services"] },
  { canonical: "Google Cloud", kind: "technology", aliases: ["GCP", "Google Cloud Platform"] },
  { canonical: "Kubernetes", kind: "technology", aliases: ["K8s"] },
  {
    canonical: "CI/CD",
    kind: "technology",
    aliases: ["CICD", "Continuous Integration", "Continuous Integration and Continuous Delivery"],
  },
  {
    canonical: "webMethods",
    kind: "technology",
    aliases: ["Software AG webMethods", "web methods", "webMethods Integration Server"],
    note: "DCS and IJS reference letters",
  },
  {
    canonical: "MuleSoft",
    kind: "technology",
    aliases: ["Mule", "Mule ESB", "Anypoint", "Anypoint Platform"],
  },
  { canonical: "Terraform", kind: "technology", aliases: ["HashiCorp Terraform"] },
  { canonical: "Docker", kind: "technology", aliases: ["Docker Containers", "Containerisation", "Containerization"] },
  { canonical: "Linux", kind: "technology", aliases: ["GNU/Linux", "RHEL", "Red Hat Enterprise Linux"] },
  { canonical: "REST APIs", kind: "technology", aliases: ["REST API", "RESTful APIs", "RESTful Services", "REST"] },

  // ---------------------------------------------------------------------
  // Architecture and governance
  // ---------------------------------------------------------------------
  {
    canonical: "TOGAF",
    kind: "certification",
    aliases: ["The Open Group Architecture Framework", "TOGAF 9", "TOGAF 10"],
  },
  { canonical: "ArchiMate", kind: "technology", aliases: ["Archi Mate"] },
  { canonical: "COBIT", kind: "certification", aliases: ["COBIT 5", "COBIT 2019", "Control Objectives for Information Technologies"] },
  {
    canonical: "Enterprise Architect",
    kind: "role",
    aliases: ["Enterprise Architect (EA)", "EA", "Enterprise Architecture"],
    note: "tenders write the seat as EA; the candidate writes the discipline",
  },
  {
    canonical: "Solutions Architect",
    kind: "role",
    aliases: ["Solution Architect", "Solutions Architecture", "Solution Architecture"],
  },
  { canonical: "Integration Architect", kind: "role", aliases: ["Integration Architecture"] },
  { canonical: "Business Architect", kind: "role", aliases: ["Business Architecture"] },
  { canonical: "Data Architect", kind: "role", aliases: ["Data Architecture", "Enterprise Data Architecture"] },
  // The live tender seats ask for the discipline ("Application Architecture")
  // while the CVs carry the role ("Application Architect"). That one pattern
  // is most of what this table is for.
  { canonical: "Application Architect", kind: "role", aliases: ["Application Architecture"] },
  { canonical: "Technology Architect", kind: "role", aliases: ["Technology Architecture"] },
  {
    canonical: "Security Architect",
    kind: "role",
    aliases: ["Security Architecture", "Information Security Architecture"],
  },
  { canonical: "Infrastructure Architect", kind: "role", aliases: ["Infrastructure Architecture"] },
  {
    canonical: "BPM Lead",
    kind: "role",
    aliases: ["Business Process Management", "BPM", "Business Process Modelling", "BPMN"],
  },

  // ---------------------------------------------------------------------
  // Service management and security
  // ---------------------------------------------------------------------
  {
    canonical: "ITIL",
    kind: "certification",
    aliases: ["ITIL v3", "ITIL v4", "IT Infrastructure Library", "ITIL Service Management"],
    note: "ITIL Foundation is a grade and stays its own term",
  },
  { canonical: "ServiceNow", kind: "technology", aliases: ["Service Now", "SNOW"] },
  { canonical: "CISSP", kind: "certification", aliases: ["Certified Information Systems Security Professional"] },
  { canonical: "CISM", kind: "certification", aliases: ["Certified Information Security Manager"] },
  { canonical: "CISA", kind: "certification", aliases: ["Certified Information Systems Auditor"] },
  { canonical: "CEH", kind: "certification", aliases: ["Certified Ethical Hacker"] },
  { canonical: "ISO 27001", kind: "certification", aliases: ["ISO/IEC 27001", "ISO27001", "ISO 27001:2022"] },
  { canonical: "SIEM", kind: "technology", aliases: ["Security Information and Event Management"] },
  { canonical: "IAM", kind: "technology", aliases: ["Identity and Access Management"] },
  { canonical: "Penetration Testing", kind: "technology", aliases: ["Pen Testing", "Pentesting", "Ethical Hacking"] },

  // ---------------------------------------------------------------------
  // Project and delivery
  // ---------------------------------------------------------------------
  {
    canonical: "PMP",
    kind: "certification",
    aliases: ["Project Management Professional", "PMI PMP"],
  },
  {
    canonical: "PRINCE2",
    kind: "certification",
    aliases: ["Prince 2", "PRINCE II", "Projects in Controlled Environments"],
    note: "PRINCE2 Agile is a different qualification and stays separate",
  },
  {
    canonical: "Certified ScrumMaster (CSM)",
    kind: "certification",
    aliases: ["CSM", "Certified Scrum Master", "Certified ScrumMaster"],
  },
  { canonical: "SAFe", kind: "certification", aliases: ["Scaled Agile Framework", "SAFe 6.0"] },
  { canonical: "Scrum", kind: "technology", aliases: ["Agile Scrum", "Scrum Methodology"] },
  { canonical: "MS Project", kind: "technology", aliases: ["Microsoft Project", "MS Projects"] },
  { canonical: "Primavera P6", kind: "technology", aliases: ["Primavera", "Oracle Primavera", "P6"] },
  { canonical: "Jira", kind: "technology", aliases: ["Atlassian Jira"] },

  // ---------------------------------------------------------------------
  // Languages, frameworks and data
  // ---------------------------------------------------------------------
  {
    canonical: "Java",
    kind: "technology",
    aliases: ["Core Java", "Java SE", "Java EE", "J2EE", "J2SE", "JDK"],
    note: "never aliased to JavaScript; the containment rule keeps them apart too",
  },
  { canonical: "JavaScript", kind: "technology", aliases: ["JS", "ECMAScript", "Vanilla JavaScript"] },
  { canonical: "TypeScript", kind: "technology", aliases: ["TS"] },
  { canonical: "Node.js", kind: "technology", aliases: ["Node", "NodeJS", "Node JS"] },
  { canonical: "React", kind: "technology", aliases: ["ReactJS", "React.js"] },
  { canonical: "Vue", kind: "technology", aliases: ["VueJS", "Vue.js"] },
  {
    canonical: "Angular",
    kind: "technology",
    aliases: ["Angular 2+"],
    note: "AngularJS is deliberately absent: 1.x is a different framework",
  },
  { canonical: "C#", kind: "technology", aliases: ["CSharp", "C Sharp"] },
  { canonical: "PostgreSQL", kind: "technology", aliases: ["Postgres", "Postgre SQL"] },
  { canonical: "Oracle E-Business Suite", kind: "technology", aliases: ["Oracle EBS", "EBS", "E-Business Suite"] },
  { canonical: "Oracle Financials", kind: "technology", aliases: ["Oracle Fusion Financials", "Oracle Fusion"] },
  {
    canonical: "HTML/CSS",
    kind: "technology",
    aliases: ["HTML and CSS", "HTML5/CSS3", "HTML5 and CSS3"],
    note: "bare HTML and bare CSS are deliberately absent: they are two skills, and folding them in would let one satisfy a requirement for the other",
  },
  { canonical: "Machine Learning Engineer", kind: "role", aliases: ["Machine Learning", "ML", "Artificial Intelligence", "AI"] },

  // ---------------------------------------------------------------------
  // Roles. Tenders abbreviate the seat; CVs write it out.
  // ---------------------------------------------------------------------
  {
    canonical: "Business Analyst",
    kind: "role",
    aliases: ["BA", "Bus Analyst", "Business Analyst (BA)", "Business Analysis"],
    note: "the single most abbreviated seat in SA public sector ICT tenders",
  },
  { canonical: "Senior Business Analyst", kind: "role", aliases: ["Snr Business Analyst", "Sr Business Analyst", "Snr BA", "Senior BA"] },
  {
    canonical: "Project Manager",
    kind: "role",
    aliases: ["PM", "Project Mgr", "Projects Manager", "Project Management"],
  },
  { canonical: "Senior Project Manager", kind: "role", aliases: ["Snr Project Manager", "Sr Project Manager", "Snr PM", "Senior PM"] },
  { canonical: "Programme Manager", kind: "role", aliases: ["Program Manager", "Programme Mgr"] },
  { canonical: "Product Owner", kind: "role", aliases: ["PO"] },
  { canonical: "Scrum Master", kind: "role", aliases: ["Scrummaster"] },
  { canonical: "Database Administrator", kind: "role", aliases: ["DBA", "Database Admin"] },
  { canonical: "Systems Analyst", kind: "role", aliases: ["Sys Analyst", "System Analyst"] },
  {
    canonical: "Software Developer",
    kind: "role",
    aliases: ["Developer", "Dev", "Programmer", "Software Development", "Applications Developer", "Application Developer"],
  },
  { canonical: "Software Engineer", kind: "role", aliases: ["SW Engineer", "Software Engineering"] },
  { canonical: "QA Engineer", kind: "role", aliases: ["Test Analyst", "QA Analyst", "Tester", "Test Engineer", "Software Tester", "Quality Assurance"] },
  { canonical: "Quantity Surveyor", kind: "role", aliases: ["QS"] },
  { canonical: "Systems Administrator", kind: "role", aliases: ["Sys Admin", "SysAdmin", "System Administrator"] },
  { canonical: "Network Engineer", kind: "role", aliases: ["Networks Engineer", "Network Specialist"] },
  { canonical: "DevOps Engineer", kind: "role", aliases: ["DevOps", "Dev Ops Engineer"] },
  { canonical: "Data Analyst", kind: "role", aliases: ["Data Analytics"] },
  { canonical: "Data Engineer", kind: "role", aliases: ["Data Engineering"] },
  {
    canonical: "Change Manager",
    kind: "role",
    aliases: [
      "Change Management",
      "OCM",
      "Organisational Change Management",
      "Organizational Change Management",
    ],
  },
  { canonical: "Functional Consultant", kind: "role", aliases: ["Functional Analyst", "Functional Lead"] },
  { canonical: "Technical Lead", kind: "role", aliases: ["Tech Lead", "Team Lead", "Technical Team Lead"] },
];
