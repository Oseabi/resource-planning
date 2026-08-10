-- ============================================================================
-- Demo dataset, 20 candidates and 10 multi-role tenders.
-- Paste this whole file into the Supabase dashboard SQL Editor and click "Run".
--
-- Purpose: give the matching engine something to chew on. The data is
-- deliberate, not random, roles, skills and certifications are copied verbatim
-- from src/lib/vocabulary.ts because scoring matches on exact normalised
-- equality. Invented strings would silently score zero and make the app look
-- broken.
--
-- Every demo row uses a fixed UUID on the 'deadbee' prefix:
--     candidates  deadbee1-...    tenders  deadbee2-...    positions  deadbee3-...
-- so supabase/seed_demo_cleanup.sql can remove all of it in one pass without
-- touching your real records.
--
-- Self-contained and idempotent: safe to re-run.
--
-- NOTE: matching is not seeded. Scores are computed in the application, so open
-- each tender and click "Match Candidates" once this has run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Candidates
--
-- Spread by design: exact-role/full-skill people score 90+, adjacent roles and
-- missing certifications land in the 40-70 band, and a few candidates match
-- nothing at all. Availability is a straight readiness bonus (10/5/0), so the
-- notice-period and unavailable entries visibly rank lower.
-- ---------------------------------------------------------------------------
insert into public.candidates (
  id, full_name, email, "current_role", additional_roles, years_experience,
  skills, technical_skills, certifications, sectors, resource_categories,
  availability, status, location
) values

-- --- ERP / Microsoft practice ---------------------------------------------
('deadbee1-0000-4000-8000-000000000001', 'Thandiwe Mokoena', 'thandiwe.mokoena@example.co.za',
 'ERP Consultant', ARRAY['Functional Analyst']::text[], 9,
 ARRAY['Business Process Analysis','ERP System Migration','Requirements Gathering','UAT']::text[],
 ARRAY['Microsoft Dynamics 365 F&O','D365 Configuration','SQL','Power BI']::text[],
 ARRAY['Microsoft Certified: Dynamics 365 F&O Apps Developer Associate']::text[],
 ARRAY['Technology','Public Sector']::text[], ARRAY['ERP']::text[],
 'available', 'active', 'Johannesburg'),

('deadbee1-0000-4000-8000-000000000002', 'Sipho Ndlovu', 'sipho.ndlovu@example.co.za',
 'ERP Consultant', ARRAY[]::text[], 5,
 ARRAY['Business Process Analysis','Functional Specification Writing','UAT']::text[],
 ARRAY['SAP','SAP S/4HANA','SAP FICO']::text[],
 ARRAY[]::text[],
 ARRAY['Technology','Finance']::text[], ARRAY['ERP']::text[],
 'notice_period', 'active', 'Pretoria'),

('deadbee1-0000-4000-8000-000000000003', 'Anele Dlamini', 'anele.dlamini@example.co.za',
 'Solutions Architect', ARRAY['Software Architect']::text[], 14,
 ARRAY['System Integration','Technical Documentation','Requirements Gathering','Mentoring']::text[],
 ARRAY['TOGAF','ArchiMate','Azure','Microsoft Dynamics 365 F&O']::text[],
 ARRAY['Microsoft Certified: Azure Fundamentals']::text[],
 ARRAY['Technology','Public Sector']::text[], ARRAY['Enterprise Architecture (EA)','ERP']::text[],
 'available', 'active', 'Johannesburg'),

('deadbee1-0000-4000-8000-000000000004', 'Rethabile Motaung', 'rethabile.motaung@example.co.za',
 'Business Analyst', ARRAY['Systems Analyst']::text[], 6,
 ARRAY['Business Process Analysis','Requirements Gathering','BPM Documentation','UAT']::text[],
 ARRAY['SQL','JIRA','Confluence','Visio']::text[],
 ARRAY[]::text[],
 ARRAY['Technology','Public Sector']::text[], ARRAY['Business Analysis']::text[],
 'available', 'active', 'Cape Town'),

('deadbee1-0000-4000-8000-000000000005', 'Kagiso Mahlangu', 'kagiso.mahlangu@example.co.za',
 'Data Engineer', ARRAY['Data Analyst']::text[], 7,
 ARRAY['Technical Documentation','System Integration']::text[],
 ARRAY['Python','SQL','Power BI','Azure','PostgreSQL']::text[],
 ARRAY['Microsoft Certified: Azure Fundamentals']::text[],
 ARRAY['Technology','Fintech']::text[], ARRAY['Data & BI']::text[],
 'available', 'active', 'Johannesburg'),

('deadbee1-0000-4000-8000-000000000006', 'Nomsa Khumalo', 'nomsa.khumalo@example.co.za',
 'DevOps Engineer', ARRAY['Cloud Engineer']::text[], 8,
 ARRAY['Code Review','Technical Documentation']::text[],
 ARRAY['Docker','Kubernetes','Terraform','CI/CD','AWS','Linux']::text[],
 ARRAY['Certified Kubernetes Administrator','AWS Certified Solutions Architect']::text[],
 ARRAY['Technology','Software']::text[], ARRAY['Cloud & DevOps']::text[],
 'available', 'active', 'Cape Town'),

-- --- Project / programme management ---------------------------------------
('deadbee1-0000-4000-8000-000000000007', 'Lerato Sibeko', 'lerato.sibeko@example.co.za',
 'Project Manager', ARRAY['Delivery Manager']::text[], 11,
 ARRAY['Project Management','Stakeholder Management','Risk Management','Budget Management','Reporting']::text[],
 ARRAY['MS Project','Jira','Confluence']::text[],
 ARRAY['PMP','PRINCE2']::text[],
 ARRAY['Consulting','Public Sector']::text[], ARRAY['Project & Programme Management']::text[],
 'available', 'active', 'Johannesburg'),

('deadbee1-0000-4000-8000-000000000008', 'Pieter Venter', 'pieter.venter@example.co.za',
 'Senior Project Manager', ARRAY['Programme Manager']::text[], 16,
 ARRAY['Programme Management','Project Management','Stakeholder Management','Change Management']::text[],
 ARRAY['MS Project','Primavera P6']::text[],
 ARRAY['PMP','MSP']::text[],
 ARRAY['Construction','Consulting']::text[], ARRAY['Project & Programme Management']::text[],
 'notice_period', 'active', 'Durban'),

('deadbee1-0000-4000-8000-000000000009', 'Zanele Mthembu', 'zanele.mthembu@example.co.za',
 'Scrum Master', ARRAY['Product Owner']::text[], 4,
 ARRAY['Scrum / Agile','Stakeholder Management','Reporting']::text[],
 ARRAY['Jira','Confluence','Scrum']::text[],
 ARRAY['Certified ScrumMaster (CSM)']::text[],
 ARRAY['Technology','Software']::text[], ARRAY['Project & Programme Management']::text[],
 -- Already placed, so pool health and the "include inactive / placed" toggle
 -- have something to show.
 'available', 'placed', 'Cape Town'),

-- --- Construction & engineering -------------------------------------------
('deadbee1-0000-4000-8000-00000000000a', 'Johan Pretorius', 'johan.pretorius@example.co.za',
 'Site Manager', ARRAY['Foreman']::text[], 18,
 ARRAY['Site Management','Health & Safety','Setting Out']::text[],
 ARRAY['AutoCAD','Navisworks']::text[],
 ARRAY['SMSTS','CSCS Gold','First Aid at Work']::text[],
 ARRAY['Construction','Infrastructure']::text[], ARRAY['Construction & Engineering']::text[],
 'available', 'active', 'Durban'),

('deadbee1-0000-4000-8000-00000000000b', 'Fatima Patel', 'fatima.patel@example.co.za',
 'Quantity Surveyor', ARRAY[]::text[], 10,
 ARRAY['Cost Management','Reporting','Vendor Management']::text[],
 ARRAY['Excel','AutoCAD']::text[],
 ARRAY['CSCS']::text[],
 ARRAY['Construction','Commercial']::text[], ARRAY['Construction & Engineering']::text[],
 'available', 'active', 'Johannesburg'),

('deadbee1-0000-4000-8000-00000000000c', 'Bongani Zulu', 'bongani.zulu@example.co.za',
 'Civil Engineer', ARRAY['Structural Engineer']::text[], 12,
 ARRAY['Technical Documentation','Risk Management']::text[],
 ARRAY['AutoCAD Civil 3D','Revit','STAAD.Pro','BIM']::text[],
 ARRAY['Chartered Engineer (CEng)','NEBOSH']::text[],
 ARRAY['Civil Engineering','Infrastructure','Bridges']::text[], ARRAY['Construction & Engineering']::text[],
 'notice_period', 'active', 'Gqeberha'),

-- --- Finance ---------------------------------------------------------------
('deadbee1-0000-4000-8000-00000000000d', 'Michelle van Wyk', 'michelle.vanwyk@example.co.za',
 'Financial Controller', ARRAY['Finance Manager']::text[], 13,
 ARRAY['Financial Reporting','Budgeting & Forecasting','Management Accounts','IFRS','Reconciliations']::text[],
 ARRAY['SAP FICO','Excel','Power BI']::text[],
 ARRAY['CA','SAICA']::text[],
 ARRAY['Finance','Audit']::text[], ARRAY['Finance & Accounting']::text[],
 'available', 'active', 'Johannesburg'),

('deadbee1-0000-4000-8000-00000000000e', 'Tebogo Radebe', 'tebogo.radebe@example.co.za',
 'Financial Analyst', ARRAY[]::text[], 5,
 ARRAY['Financial Modelling','Financial Reporting','Budgeting & Forecasting']::text[],
 ARRAY['Excel','SQL','Power BI']::text[],
 ARRAY['CFA']::text[],
 ARRAY['Finance','Banking']::text[], ARRAY['Finance & Accounting']::text[],
 'available', 'active', 'Sandton'),

('deadbee1-0000-4000-8000-00000000000f', 'Yusuf Ebrahim', 'yusuf.ebrahim@example.co.za',
 'Auditor', ARRAY['Management Accountant']::text[], 8,
 ARRAY['Auditing','Tax Compliance','Reconciliations','Financial Reporting']::text[],
 ARRAY['Excel','Sage']::text[],
 ARRAY['ACCA']::text[],
 ARRAY['Audit','Finance','Public Sector']::text[], ARRAY['Finance & Accounting']::text[],
 'available', 'active', 'Cape Town'),

-- --- Healthcare ------------------------------------------------------------
('deadbee1-0000-4000-8000-000000000010', 'Sister Naledi Moloi', 'naledi.moloi@example.co.za',
 'Registered Nurse', ARRAY[]::text[], 9,
 ARRAY['Patient Care','Clinical Governance']::text[],
 ARRAY['EMR Systems','Epic']::text[],
 ARRAY['BLS','ACLS']::text[],
 ARRAY['Healthcare','Private Care']::text[], ARRAY[]::text[],
 'available', 'active', 'Bloemfontein'),

('deadbee1-0000-4000-8000-000000000011', 'Dr Ayanda Cele', 'ayanda.cele@example.co.za',
 'Clinical Manager', ARRAY[]::text[], 15,
 ARRAY['Clinical Governance','Stakeholder Management','Reporting']::text[],
 ARRAY['EMR Systems','Cerner','Medical Coding']::text[],
 ARRAY['BLS']::text[],
 ARRAY['Healthcare','Public Sector']::text[], ARRAY[]::text[],
 'unavailable', 'active', 'Durban'),

-- --- Marketing / HR / Executive -------------------------------------------
('deadbee1-0000-4000-8000-000000000012', 'Chloe Adams', 'chloe.adams@example.co.za',
 'Digital Marketing Specialist', ARRAY[]::text[], 6,
 ARRAY['Campaign Management','Content Strategy']::text[],
 ARRAY['Google Analytics','Google Ads','HubSpot','SEO Tools']::text[],
 ARRAY['Google Ads Certification','HubSpot Inbound']::text[],
 ARRAY['Marketing','E-commerce']::text[], ARRAY[]::text[],
 'available', 'active', 'Cape Town'),

('deadbee1-0000-4000-8000-000000000013', 'Precious Nkosi', 'precious.nkosi@example.co.za',
 'HR Manager', ARRAY[]::text[], 11,
 ARRAY['Employee Relations','Talent Acquisition','Performance Management']::text[],
 ARRAY['Workday','SAP SuccessFactors','ATS Systems']::text[],
 ARRAY['CIPD']::text[],
 ARRAY['Human Resources','Corporate']::text[], ARRAY[]::text[],
 'available', 'inactive', 'Johannesburg'),

('deadbee1-0000-4000-8000-000000000014', 'Gerhard Steyn', 'gerhard.steyn@example.co.za',
 'Chief Financial Officer', ARRAY['Executive Director']::text[], 24,
 ARRAY['Strategic Planning','Corporate Governance','P&L Management','Board Reporting','Mergers & Acquisitions']::text[],
 ARRAY['Excel','Power BI']::text[],
 ARRAY['CA','MBA','IoD Chartered Director']::text[],
 ARRAY['Corporate','Finance']::text[], ARRAY['Executive & Board','Finance & Accounting']::text[],
 'available', 'active', 'Sandton')

on conflict (id) do nothing;


-- ---------------------------------------------------------------------------
-- Tenders
--
-- The tender-level required_roles / required_skills are still populated because
-- the detail page renders them as tags and feeds the pool-gap panel; the real
-- requirements now live on positions below.
-- ---------------------------------------------------------------------------
insert into public.tenders (
  id, title, reference_number, client, location, value,
  submission_deadline, contract_start_date,
  required_roles, required_skills, required_certifications, sectors,
  min_experience_years, status
) values

('deadbee2-0000-4000-8000-000000000001',
 'Design, development and support of a national ERP platform', 'RFP-2026/ERP-014',
 'Department of Public Works', 'Pretoria', 18500000, '2026-09-30', '2026-11-01',
 ARRAY['ERP Consultant','Business Analyst','Solutions Architect']::text[],
 ARRAY['Microsoft Dynamics 365 F&O','Business Process Analysis']::text[],
 ARRAY['Microsoft Certified: Dynamics 365 F&O Apps Developer Associate']::text[],
 ARRAY['Public Sector','Technology']::text[], 5, 'live'),

('deadbee2-0000-4000-8000-000000000002',
 'SAP S/4HANA finance migration and post-go-live support', 'RFP-2026/SAP-021',
 'Transnet SOC Ltd', 'Johannesburg', 24000000, '2026-10-15', '2026-12-01',
 ARRAY['ERP Consultant','Data Engineer']::text[],
 ARRAY['SAP S/4HANA','ERP System Migration']::text[],
 ARRAY[]::text[],
 ARRAY['Public Sector','Technology']::text[], 5, 'live'),

('deadbee2-0000-4000-8000-000000000003',
 'Enterprise architecture practice establishment', 'RFB-2026/EA-007',
 'Gauteng Provincial Treasury', 'Johannesburg', 9500000, '2026-09-18', '2026-10-15',
 ARRAY['Solutions Architect','Business Analyst']::text[],
 ARRAY['TOGAF','ArchiMate']::text[],
 ARRAY[]::text[],
 ARRAY['Public Sector','Technology']::text[], 8, 'submitted'),

('deadbee2-0000-4000-8000-000000000004',
 'Cloud migration and DevOps enablement programme', 'RFP-2026/CLD-033',
 'Standard Bank', 'Johannesburg', 15200000, '2026-11-05', '2027-01-10',
 ARRAY['DevOps Engineer','Cloud Engineer','Solutions Architect']::text[],
 ARRAY['Kubernetes','Terraform','CI/CD']::text[],
 ARRAY['Certified Kubernetes Administrator']::text[],
 ARRAY['Finance','Technology']::text[], 5, 'live'),

('deadbee2-0000-4000-8000-000000000005',
 'N3 corridor bridge rehabilitation, professional services', 'RFP-2026/INF-102',
 'SANRAL', 'Durban', 42000000, '2026-10-01', '2026-11-20',
 ARRAY['Civil Engineer','Site Manager','Quantity Surveyor']::text[],
 ARRAY['AutoCAD Civil 3D','BIM']::text[],
 ARRAY['Chartered Engineer (CEng)','SMSTS']::text[],
 ARRAY['Civil Engineering','Infrastructure','Bridges']::text[], 8, 'live'),

('deadbee2-0000-4000-8000-000000000006',
 'Commercial office fit-out, construction management', 'RFQ-2026/FIT-058',
 'Growthpoint Properties', 'Cape Town', 7800000, '2026-09-12', '2026-10-01',
 ARRAY['Site Manager','Quantity Surveyor']::text[],
 ARRAY['AutoCAD']::text[],
 ARRAY['SMSTS','CSCS Gold']::text[],
 ARRAY['Construction','Fit Out','Commercial']::text[], 6, 'won'),

('deadbee2-0000-4000-8000-000000000007',
 'Internal audit and financial control co-sourcing', 'RFP-2026/FIN-076',
 'City of Cape Town', 'Cape Town', 6400000, '2026-09-25', '2026-11-01',
 ARRAY['Auditor','Financial Controller','Financial Analyst']::text[],
 ARRAY['Auditing','IFRS']::text[],
 ARRAY['CA','ACCA']::text[],
 ARRAY['Audit','Finance','Public Sector']::text[], 5, 'live'),

('deadbee2-0000-4000-8000-000000000008',
 'Hospital information system rollout, clinical workstream', 'RFP-2026/HLT-045',
 'Netcare', 'Johannesburg', 11300000, '2026-10-20', '2026-12-05',
 ARRAY['Clinical Manager','Registered Nurse','Business Analyst']::text[],
 ARRAY['EMR Systems','Epic']::text[],
 ARRAY['BLS']::text[],
 ARRAY['Healthcare','Private Care']::text[], 5, 'draft'),

('deadbee2-0000-4000-8000-000000000009',
 'Actuarial modelling and pricing review', 'RFP-2026/ACT-011',
 'Old Mutual', 'Cape Town', 5200000, '2026-11-15', '2027-01-05',
 ARRAY['Actuary','Data Scientist']::text[],
 ARRAY['R','Python']::text[],
 ARRAY['CFA']::text[],
 ARRAY['Insurance','Finance']::text[], 6, 'draft'),

('deadbee2-0000-4000-8000-00000000000a',
 'Programme management office, multi-year transformation', 'RFP-2026/PMO-088',
 'Eskom Holdings', 'Johannesburg', 31000000, '2026-10-08', '2026-12-01',
 ARRAY['Programme Manager','Project Manager','Change Manager','Business Analyst']::text[],
 ARRAY['Programme Management','Change Management']::text[],
 ARRAY['PMP','MSP']::text[],
 ARRAY['Public Sector','Consulting']::text[], 5, 'live')

on conflict (id) do nothing;


-- ---------------------------------------------------------------------------
-- Positions, the point of the exercise
--
-- Every line carries its OWN skills, certifications and experience floor, so a
-- candidate scores differently against each seat. Note tender 1, which asks for
-- the same role at two different floors (5 years and 10 years), the clearest
-- demonstration of why per-position matching exists.
--
-- Empty required_skills/required_certifications would score 1 (full marks) and
-- flatten the spread, so every line is populated.
-- ---------------------------------------------------------------------------
insert into public.positions (
  id, parent_type, parent_id, role, quantity, min_experience_years,
  required_skills, required_certifications, sort_order
) values

-- Tender 1, national ERP platform (same role, two experience floors)
('deadbee3-0000-4000-8000-000000000101', 'tender', 'deadbee2-0000-4000-8000-000000000001',
 'ERP Consultant', 3, 5,
 ARRAY['Business Process Analysis','ERP System Migration','UAT','Microsoft Dynamics 365 F&O']::text[],
 ARRAY['Microsoft Certified: Dynamics 365 F&O Apps Developer Associate']::text[], 0),
('deadbee3-0000-4000-8000-000000000102', 'tender', 'deadbee2-0000-4000-8000-000000000001',
 'ERP Consultant', 1, 10,
 ARRAY['Business Process Analysis','ERP System Migration','D365 Configuration','Requirements Gathering']::text[],
 ARRAY['Microsoft Certified: Dynamics 365 F&O Apps Developer Associate']::text[], 1),
('deadbee3-0000-4000-8000-000000000103', 'tender', 'deadbee2-0000-4000-8000-000000000001',
 'Business Analyst', 2, 4,
 ARRAY['Requirements Gathering','BPM Documentation','UAT','Business Process Analysis']::text[],
 ARRAY['Certified ScrumMaster (CSM)']::text[], 2),
('deadbee3-0000-4000-8000-000000000104', 'tender', 'deadbee2-0000-4000-8000-000000000001',
 'Solutions Architect', 1, 10,
 ARRAY['System Integration','TOGAF','Technical Documentation']::text[],
 ARRAY['Microsoft Certified: Azure Fundamentals']::text[], 3),

-- Tender 2, SAP migration
('deadbee3-0000-4000-8000-000000000201', 'tender', 'deadbee2-0000-4000-8000-000000000002',
 'ERP Consultant', 2, 5,
 ARRAY['SAP S/4HANA','SAP','ERP System Migration','Functional Specification Writing']::text[],
 ARRAY['Microsoft Certified: Dynamics 365 F&O Apps Developer Associate']::text[], 0),
('deadbee3-0000-4000-8000-000000000202', 'tender', 'deadbee2-0000-4000-8000-000000000002',
 'Data Engineer', 2, 4,
 ARRAY['SQL','Python','Power BI','System Integration']::text[],
 ARRAY['Microsoft Certified: Azure Fundamentals']::text[], 1),

-- Tender 3, enterprise architecture
('deadbee3-0000-4000-8000-000000000301', 'tender', 'deadbee2-0000-4000-8000-000000000003',
 'Solutions Architect', 1, 12,
 ARRAY['TOGAF','ArchiMate','System Integration','Technical Documentation']::text[],
 ARRAY['Microsoft Certified: Azure Fundamentals']::text[], 0),
('deadbee3-0000-4000-8000-000000000302', 'tender', 'deadbee2-0000-4000-8000-000000000003',
 'Business Analyst', 2, 5,
 ARRAY['Requirements Gathering','Business Process Analysis','BPM Documentation']::text[],
 ARRAY['Certified ScrumMaster (CSM)']::text[], 1),

-- Tender 4, cloud & DevOps
('deadbee3-0000-4000-8000-000000000401', 'tender', 'deadbee2-0000-4000-8000-000000000004',
 'DevOps Engineer', 3, 5,
 ARRAY['Kubernetes','Terraform','CI/CD','Docker']::text[],
 ARRAY['Certified Kubernetes Administrator']::text[], 0),
('deadbee3-0000-4000-8000-000000000402', 'tender', 'deadbee2-0000-4000-8000-000000000004',
 'Cloud Engineer', 2, 4,
 ARRAY['AWS','Linux','CI/CD']::text[],
 ARRAY['AWS Certified Solutions Architect']::text[], 1),
('deadbee3-0000-4000-8000-000000000403', 'tender', 'deadbee2-0000-4000-8000-000000000004',
 'Security Engineer', 1, 6,
 ARRAY['Linux','Technical Documentation','System Integration']::text[],
 ARRAY['CompTIA Security+']::text[], 2),

-- Tender 5, bridge rehabilitation
('deadbee3-0000-4000-8000-000000000501', 'tender', 'deadbee2-0000-4000-8000-000000000005',
 'Civil Engineer', 2, 8,
 ARRAY['AutoCAD Civil 3D','STAAD.Pro','BIM','Technical Documentation']::text[],
 ARRAY['Chartered Engineer (CEng)']::text[], 0),
('deadbee3-0000-4000-8000-000000000502', 'tender', 'deadbee2-0000-4000-8000-000000000005',
 'Site Manager', 2, 10,
 ARRAY['Site Management','Health & Safety','Setting Out']::text[],
 ARRAY['SMSTS','CSCS Gold']::text[], 1),
('deadbee3-0000-4000-8000-000000000503', 'tender', 'deadbee2-0000-4000-8000-000000000005',
 'Quantity Surveyor', 1, 8,
 ARRAY['Cost Management','Reporting','Vendor Management']::text[],
 ARRAY['CSCS']::text[], 2),

-- Tender 6, office fit-out (won; team can be confirmed)
('deadbee3-0000-4000-8000-000000000601', 'tender', 'deadbee2-0000-4000-8000-000000000006',
 'Site Manager', 1, 6,
 ARRAY['Site Management','Health & Safety']::text[],
 ARRAY['SMSTS']::text[], 0),
('deadbee3-0000-4000-8000-000000000602', 'tender', 'deadbee2-0000-4000-8000-000000000006',
 'Quantity Surveyor', 1, 5,
 ARRAY['Cost Management','Reporting']::text[],
 ARRAY['CSCS']::text[], 1),

-- Tender 7, audit co-sourcing
('deadbee3-0000-4000-8000-000000000701', 'tender', 'deadbee2-0000-4000-8000-000000000007',
 'Auditor', 2, 5,
 ARRAY['Auditing','Tax Compliance','Reconciliations']::text[],
 ARRAY['ACCA']::text[], 0),
('deadbee3-0000-4000-8000-000000000702', 'tender', 'deadbee2-0000-4000-8000-000000000007',
 'Financial Controller', 1, 10,
 ARRAY['Financial Reporting','IFRS','Management Accounts','Budgeting & Forecasting']::text[],
 ARRAY['CA']::text[], 1),
('deadbee3-0000-4000-8000-000000000703', 'tender', 'deadbee2-0000-4000-8000-000000000007',
 'Financial Analyst', 2, 3,
 ARRAY['Financial Modelling','Financial Reporting']::text[],
 ARRAY['CFA']::text[], 2),

-- Tender 8, hospital information system
('deadbee3-0000-4000-8000-000000000801', 'tender', 'deadbee2-0000-4000-8000-000000000008',
 'Clinical Manager', 1, 10,
 ARRAY['Clinical Governance','Stakeholder Management','Reporting']::text[],
 ARRAY['BLS']::text[], 0),
('deadbee3-0000-4000-8000-000000000802', 'tender', 'deadbee2-0000-4000-8000-000000000008',
 'Registered Nurse', 4, 5,
 ARRAY['Patient Care','Clinical Governance']::text[],
 ARRAY['BLS','ACLS']::text[], 1),
('deadbee3-0000-4000-8000-000000000803', 'tender', 'deadbee2-0000-4000-8000-000000000008',
 'Business Analyst', 1, 5,
 ARRAY['Requirements Gathering','Business Process Analysis','UAT']::text[],
 ARRAY['Certified ScrumMaster (CSM)']::text[], 2),

-- Tender 9, actuarial (deliberate gap: nobody in the pool is an Actuary)
('deadbee3-0000-4000-8000-000000000901', 'tender', 'deadbee2-0000-4000-8000-000000000009',
 'Actuary', 2, 6,
 ARRAY['Financial Modelling','R','Python']::text[],
 ARRAY['CFA']::text[], 0),
('deadbee3-0000-4000-8000-000000000902', 'tender', 'deadbee2-0000-4000-8000-000000000009',
 'Data Scientist', 1, 5,
 ARRAY['Python','R','SQL']::text[],
 ARRAY['Microsoft Certified: Azure Fundamentals']::text[], 1),

-- Tender 10, PMO transformation (Change Manager is a second deliberate gap)
('deadbee3-0000-4000-8000-000000000a01', 'tender', 'deadbee2-0000-4000-8000-00000000000a',
 'Programme Manager', 1, 12,
 ARRAY['Programme Management','Stakeholder Management','Risk Management','Budget Management']::text[],
 ARRAY['MSP','PMP']::text[], 0),
('deadbee3-0000-4000-8000-000000000a02', 'tender', 'deadbee2-0000-4000-8000-00000000000a',
 'Project Manager', 4, 6,
 ARRAY['Project Management','Stakeholder Management','Risk Management','Reporting']::text[],
 ARRAY['PMP']::text[], 1),
('deadbee3-0000-4000-8000-000000000a03', 'tender', 'deadbee2-0000-4000-8000-00000000000a',
 'Change Manager', 2, 8,
 ARRAY['Change Management','Stakeholder Management','Organisational Leadership']::text[],
 ARRAY['PRINCE2']::text[], 2),
('deadbee3-0000-4000-8000-000000000a04', 'tender', 'deadbee2-0000-4000-8000-00000000000a',
 'Business Analyst', 3, 4,
 ARRAY['Requirements Gathering','Business Process Analysis','BPM Documentation']::text[],
 ARRAY['Certified ScrumMaster (CSM)']::text[], 3)

on conflict (id) do nothing;
