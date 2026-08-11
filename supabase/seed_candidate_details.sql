-- ============================================================================
-- Demo dataset, part 2: fill in the 20 candidate profiles.
-- Paste this whole file into the Supabase dashboard SQL Editor and click "Run".
--
-- Run supabase/seed_demo.sql first. This only updates rows it created.
--
-- Purpose: seed_demo.sql populates the columns the matching engine reads and
-- nothing else, so every demo profile is half empty on screen. The Experience
-- tab says "No work experience recorded", most profiles say "No education or
-- certifications recorded", and Contact shows an email and a city because
-- phone, LinkedIn and portfolio are all null. Two of the four tabs are blank.
--
-- This fills phone, professional_summary, qualifications, languages,
-- linkedin_url, work_experience and education for all 20, so the app can
-- actually be walked through.
--
-- The JSON shapes must match WorkExperience and Education in
-- src/lib/supabase/database.types.ts, because the profile page reads those keys
-- directly:
--   work_experience  {title, company, location, employment_type,
--                     start_date, end_date, is_current, description, achievements}
--   education        {qualification, field, institution, year}
-- Dates are rendered as written, so they are human strings ("Mar 2021"), not ISO.
--
-- The content is deliberately consistent rather than random: the most recent
-- job title matches current_role, and the dates add up to years_experience.
-- Employers and universities are real South African ones so the pool reads as
-- plausible in front of a client.
--
-- Four candidates also get an available_from date (migration 0013). Without at
-- least one, the bench forecast on the dashboard is a flat line and the "free
-- by" filter has nothing to exclude, so the whole forward-planning feature
-- looks broken in a walkthrough for the same reason the compliance one did.
-- The dates are spread across four different months on purpose:
--
--   Pieter Venter    30 Sep 2026   serving notice
--   Bongani Zulu     15 Oct 2026   serving notice
--   Sipho Ndlovu      1 Nov 2026   serving notice
--   Dr Ayanda Cele   31 Jan 2027   committed elsewhere, marked unavailable
--
-- Each is someone whose seeded availability already says they are not free, so
-- the date agrees with the badge rather than contradicting it. Clear any of them
-- from the candidate edit form if you would rather demo a full bench.
--
-- Self-contained and idempotent: safe to re-run.
--
-- NOTE: updating a candidate fires the candidates_set_search_text trigger, so
-- search_text is rebuilt and these summaries become searchable straight away.
-- ============================================================================

-- --- ERP / Microsoft practice ----------------------------------------------

update public.candidates set
  phone = '+27 82 431 7765',
  linkedin_url = 'https://www.linkedin.com/in/thandiwe-mokoena',
  languages = ARRAY['English','isiZulu','Sesotho']::text[],
  qualifications = ARRAY['BCom Information Systems']::text[],
  professional_summary = 'Dynamics 365 Finance and Operations consultant with nine years across public sector and financial services implementations. Leads requirements workshops through to user acceptance testing, and has run two full migrations off legacy general ledgers. Comfortable as the bridge between finance stakeholders and the technical build team.',
  work_experience = '[
    {"title":"ERP Consultant","company":"Deloitte Africa","location":"Johannesburg","employment_type":"Permanent","start_date":"Feb 2021","end_date":null,"is_current":true,"description":"Functional lead on Dynamics 365 F&O rollouts for public sector and financial services clients.","achievements":"Led the finance workstream on a national department rollout covering 1 400 users, delivered on schedule."},
    {"title":"Functional Analyst","company":"Dimension Data","location":"Johannesburg","employment_type":"Permanent","start_date":"Mar 2017","end_date":"Jan 2021","is_current":false,"description":"Requirements gathering and functional specification for ERP and workflow projects.","achievements":"Built the reusable UAT pack still used as the practice standard."}
  ]'::jsonb,
  education = '[
    {"qualification":"BCom","field":"Information Systems","institution":"University of Johannesburg","year":"2016"}
  ]'::jsonb
where id = 'deadbee1-0000-4000-8000-000000000001';

update public.candidates set
  phone = '+27 71 908 2214',
  -- Serving notice, so he is not free until it runs out. See the note at the
  -- foot of this file on why a few of these dates are set.
  available_from = '2026-11-01',
  linkedin_url = 'https://www.linkedin.com/in/sipho-ndlovu-sap',
  languages = ARRAY['English','isiZulu']::text[],
  qualifications = ARRAY['BSc Computer Science']::text[],
  professional_summary = 'SAP functional consultant focused on FICO, with five years of implementation and support experience. Has worked on one full S/4HANA migration as part of a larger team. Currently serving notice.',
  work_experience = '[
    {"title":"ERP Consultant","company":"EOH","location":"Pretoria","employment_type":"Permanent","start_date":"Apr 2023","end_date":null,"is_current":true,"description":"SAP FICO configuration and support across two mining sector clients.","achievements":"Cut month-end close from nine days to five at the largest account."},
    {"title":"SAP Functional Analyst","company":"Britehouse","location":"Pretoria","employment_type":"Permanent","start_date":"Jan 2021","end_date":"Mar 2023","is_current":false,"description":"Support and enhancement work on SAP ECC finance modules.","achievements":null}
  ]'::jsonb,
  education = '[
    {"qualification":"BSc","field":"Computer Science","institution":"University of Pretoria","year":"2020"}
  ]'::jsonb
where id = 'deadbee1-0000-4000-8000-000000000002';

update public.candidates set
  phone = '+27 83 552 0091',
  linkedin_url = 'https://www.linkedin.com/in/anele-dlamini-architect',
  languages = ARRAY['English','isiZulu','Afrikaans']::text[],
  qualifications = ARRAY['BSc Eng Electrical','MSc Computer Science']::text[],
  professional_summary = 'Solutions architect with fourteen years spanning software engineering, integration and enterprise architecture. TOGAF practitioner who has owned target-state architecture for a large banking programme. Regularly mentors developers and reviews designs across teams.',
  work_experience = '[
    {"title":"Solutions Architect","company":"Standard Bank","location":"Johannesburg","employment_type":"Permanent","start_date":"Jun 2019","end_date":null,"is_current":true,"description":"Owns target-state architecture and integration patterns for the corporate banking platform.","achievements":"Defined the integration standard now applied across seven downstream systems."},
    {"title":"Senior Software Architect","company":"BCX","location":"Johannesburg","employment_type":"Permanent","start_date":"Aug 2015","end_date":"May 2019","is_current":false,"description":"Design authority on public sector integration projects.","achievements":null},
    {"title":"Software Developer","company":"MTN","location":"Johannesburg","employment_type":"Permanent","start_date":"Jan 2012","end_date":"Jul 2015","is_current":false,"description":"Backend development on billing and provisioning systems.","achievements":null}
  ]'::jsonb,
  education = '[
    {"qualification":"MSc","field":"Computer Science","institution":"University of the Witwatersrand","year":"2015"},
    {"qualification":"BSc Eng","field":"Electrical Engineering","institution":"University of the Witwatersrand","year":"2011"}
  ]'::jsonb
where id = 'deadbee1-0000-4000-8000-000000000003';

update public.candidates set
  phone = '+27 84 117 6620',
  linkedin_url = 'https://www.linkedin.com/in/rethabile-motaung',
  languages = ARRAY['English','Sesotho','Afrikaans']::text[],
  qualifications = ARRAY['BCom Informatics']::text[],
  professional_summary = 'Business analyst with six years in financial services, working across process mapping, requirements and user acceptance testing. Known for turning vague stakeholder asks into specifications a development team can build from. Has run analysis on two regulatory reporting projects.',
  work_experience = '[
    {"title":"Business Analyst","company":"Old Mutual","location":"Cape Town","employment_type":"Permanent","start_date":"Sep 2022","end_date":null,"is_current":true,"description":"Requirements and process analysis for the retail investment platform.","achievements":"Documented the end-to-end onboarding process that had never been mapped, cutting handover queries sharply."},
    {"title":"Systems Analyst","company":"Sanlam","location":"Cape Town","employment_type":"Permanent","start_date":"Feb 2020","end_date":"Aug 2022","is_current":false,"description":"Analysis and testing support on policy administration systems.","achievements":null}
  ]'::jsonb,
  education = '[
    {"qualification":"BCom","field":"Informatics","institution":"University of South Africa","year":"2019"}
  ]'::jsonb
where id = 'deadbee1-0000-4000-8000-000000000004';

update public.candidates set
  phone = '+27 79 224 8813',
  linkedin_url = 'https://www.linkedin.com/in/kagiso-mahlangu-data',
  languages = ARRAY['English','isiZulu','Setswana']::text[],
  qualifications = ARRAY['BSc Statistics']::text[],
  professional_summary = 'Data engineer with seven years building pipelines and reporting layers in insurance and banking. Works day to day in Python, SQL and Azure, with Power BI on the presentation side. Has taken two data warehouses from design through to production.',
  work_experience = '[
    {"title":"Data Engineer","company":"Discovery","location":"Johannesburg","employment_type":"Permanent","start_date":"Jul 2022","end_date":null,"is_current":true,"description":"Builds and maintains the ingestion pipelines feeding the health analytics warehouse.","achievements":"Rebuilt the nightly load to run in under an hour, down from six."},
    {"title":"Data Analyst","company":"Absa","location":"Johannesburg","employment_type":"Permanent","start_date":"Mar 2019","end_date":"Jun 2022","is_current":false,"description":"Reporting and analysis for the retail credit portfolio.","achievements":null}
  ]'::jsonb,
  education = '[
    {"qualification":"BSc","field":"Statistics","institution":"University of the Witwatersrand","year":"2018"}
  ]'::jsonb
where id = 'deadbee1-0000-4000-8000-000000000005';

update public.candidates set
  phone = '+27 82 660 3374',
  linkedin_url = 'https://www.linkedin.com/in/nomsa-khumalo-devops',
  languages = ARRAY['English','isiXhosa','isiZulu']::text[],
  qualifications = ARRAY['BSc Computer Science']::text[],
  professional_summary = 'DevOps engineer with eight years running container platforms and delivery pipelines at scale. Certified on both Kubernetes and AWS, and has led one full migration out of an on-premise data centre. Strong on infrastructure as code and on getting teams to adopt it.',
  work_experience = '[
    {"title":"DevOps Engineer","company":"Takealot","location":"Cape Town","employment_type":"Permanent","start_date":"May 2021","end_date":null,"is_current":true,"description":"Owns the Kubernetes platform and CI/CD tooling used by the engineering teams.","achievements":"Took deployment frequency from fortnightly to several times a day without adding incidents."},
    {"title":"Systems Engineer","company":"Amazon Development Centre South Africa","location":"Cape Town","employment_type":"Permanent","start_date":"Feb 2018","end_date":"Apr 2021","is_current":false,"description":"Infrastructure automation and platform reliability work.","achievements":null}
  ]'::jsonb,
  education = '[
    {"qualification":"BSc","field":"Computer Science","institution":"University of Cape Town","year":"2017"}
  ]'::jsonb
where id = 'deadbee1-0000-4000-8000-000000000006';

-- --- Project / programme management ----------------------------------------

update public.candidates set
  phone = '+27 83 771 4405',
  linkedin_url = 'https://www.linkedin.com/in/lerato-sibeko-pm',
  languages = ARRAY['English','isiZulu','Sesotho']::text[],
  qualifications = ARRAY['BTech Project Management']::text[],
  professional_summary = 'Project manager with eleven years delivering technology projects in consulting and the public sector. Holds both PMP and PRINCE2, and has run budgets up to R40 million. Strong on stakeholder management where the client side is fragmented.',
  work_experience = '[
    {"title":"Project Manager","company":"Accenture South Africa","location":"Johannesburg","employment_type":"Permanent","start_date":"Oct 2019","end_date":null,"is_current":true,"description":"Runs delivery on public sector technology programmes.","achievements":"Brought a stalled municipal billing project back to plan and closed it within budget."},
    {"title":"Delivery Manager","company":"IBM South Africa","location":"Johannesburg","employment_type":"Permanent","start_date":"Jan 2015","end_date":"Sep 2019","is_current":false,"description":"Delivery ownership across a portfolio of managed services accounts.","achievements":null}
  ]'::jsonb,
  education = '[
    {"qualification":"BTech","field":"Project Management","institution":"Tshwane University of Technology","year":"2014"}
  ]'::jsonb
where id = 'deadbee1-0000-4000-8000-000000000007';

update public.candidates set
  phone = '+27 82 309 1187',
  available_from = '2026-09-30',
  linkedin_url = 'https://www.linkedin.com/in/pieter-venter-programme',
  languages = ARRAY['Afrikaans','English']::text[],
  qualifications = ARRAY['BEng Civil Engineering']::text[],
  professional_summary = 'Senior project and programme manager with sixteen years in construction and infrastructure delivery. Has run multi-contractor programmes with values above R500 million, using Primavera P6 for planning. Currently serving notice and available at the end of it.',
  work_experience = '[
    {"title":"Senior Project Manager","company":"Group Five","location":"Durban","employment_type":"Permanent","start_date":"Mar 2018","end_date":null,"is_current":true,"description":"Programme delivery across a portfolio of road and bridge contracts.","achievements":"Recovered an eleven-week schedule slip on a bridge deck contract without additional cost to the client."},
    {"title":"Programme Manager","company":"Aveng","location":"Durban","employment_type":"Permanent","start_date":"Jun 2013","end_date":"Feb 2018","is_current":false,"description":"Planning and controls across concurrent civil contracts.","achievements":null},
    {"title":"Project Engineer","company":"Murray and Roberts","location":"Johannesburg","employment_type":"Permanent","start_date":"Feb 2010","end_date":"May 2013","is_current":false,"description":"Site engineering on structural and civil packages.","achievements":null}
  ]'::jsonb,
  education = '[
    {"qualification":"BEng","field":"Civil Engineering","institution":"Stellenbosch University","year":"2009"}
  ]'::jsonb
where id = 'deadbee1-0000-4000-8000-000000000008';

update public.candidates set
  phone = '+27 76 445 9930',
  linkedin_url = 'https://www.linkedin.com/in/zanele-mthembu-scrum',
  languages = ARRAY['English','isiZulu']::text[],
  qualifications = ARRAY['BCom Information Systems']::text[],
  professional_summary = 'Scrum master with four years in financial services, currently on placement. Certified ScrumMaster who came into the role from business analysis, which shows in how closely she works with product owners. Runs three squads on the current engagement.',
  work_experience = '[
    {"title":"Scrum Master","company":"Investec","location":"Cape Town","employment_type":"Contract","start_date":"Jan 2024","end_date":null,"is_current":true,"description":"Facilitates delivery for three squads on the private banking platform.","achievements":"Halved carry-over between sprints by reworking how the backlog was refined."},
    {"title":"Business Analyst","company":"Allan Gray","location":"Cape Town","employment_type":"Permanent","start_date":"Feb 2022","end_date":"Dec 2023","is_current":false,"description":"Analysis on client reporting and onboarding journeys.","achievements":null}
  ]'::jsonb,
  education = '[
    {"qualification":"BCom","field":"Information Systems","institution":"University of the Western Cape","year":"2021"}
  ]'::jsonb
where id = 'deadbee1-0000-4000-8000-000000000009';

-- --- Construction and engineering ------------------------------------------

update public.candidates set
  phone = '+27 82 224 7719',
  linkedin_url = 'https://www.linkedin.com/in/johan-pretorius-site',
  languages = ARRAY['Afrikaans','English','isiZulu']::text[],
  qualifications = ARRAY['National Diploma Building']::text[],
  professional_summary = 'Site manager with eighteen years on commercial and infrastructure projects. Holds SMSTS and CSCS Gold, with an unbroken safety record across the last four contracts. Known for running tight programmes on congested urban sites.',
  work_experience = '[
    {"title":"Site Manager","company":"WBHO Construction","location":"Durban","employment_type":"Permanent","start_date":"Apr 2016","end_date":null,"is_current":true,"description":"Site delivery on commercial builds and infrastructure packages.","achievements":"Delivered a fourteen-storey commercial build two weeks early with no lost-time incidents."},
    {"title":"Site Foreman","company":"Stefanutti Stocks","location":"Durban","employment_type":"Permanent","start_date":"Jan 2008","end_date":"Mar 2016","is_current":false,"description":"Supervision of civil and structural works packages.","achievements":null}
  ]'::jsonb,
  education = '[
    {"qualification":"National Diploma","field":"Building","institution":"Durban University of Technology","year":"2007"}
  ]'::jsonb
where id = 'deadbee1-0000-4000-8000-00000000000a';

update public.candidates set
  phone = '+27 83 118 5562',
  linkedin_url = 'https://www.linkedin.com/in/fatima-patel-qs',
  languages = ARRAY['English','Afrikaans','Gujarati']::text[],
  qualifications = ARRAY['BSc Quantity Surveying']::text[],
  professional_summary = 'Quantity surveyor with ten years across commercial fit-out and infrastructure. Handles measurement, valuation and final accounts, and has settled two contested final accounts without going to adjudication. Works closely with site teams rather than from the office.',
  work_experience = '[
    {"title":"Quantity Surveyor","company":"Turner and Townsend","location":"Johannesburg","employment_type":"Permanent","start_date":"Aug 2020","end_date":null,"is_current":true,"description":"Cost management on commercial fit-out and infrastructure contracts.","achievements":"Settled a disputed final account R4.2 million below the contractor claim."},
    {"title":"Assistant Quantity Surveyor","company":"AECOM","location":"Johannesburg","employment_type":"Permanent","start_date":"Feb 2016","end_date":"Jul 2020","is_current":false,"description":"Measurement, valuations and cost reporting.","achievements":null}
  ]'::jsonb,
  education = '[
    {"qualification":"BSc","field":"Quantity Surveying","institution":"University of the Witwatersrand","year":"2015"}
  ]'::jsonb
where id = 'deadbee1-0000-4000-8000-00000000000b';

update public.candidates set
  phone = '+27 71 663 2208',
  available_from = '2026-10-15',
  linkedin_url = 'https://www.linkedin.com/in/bongani-zulu-civil',
  languages = ARRAY['English','isiXhosa','isiZulu']::text[],
  qualifications = ARRAY['BEng Civil Engineering']::text[],
  professional_summary = 'Chartered civil engineer with twelve years in bridge and structural design. Works in Civil 3D and STAAD.Pro, with BIM delivery on the last three projects. Currently serving notice.',
  work_experience = '[
    {"title":"Civil Engineer","company":"SMEC South Africa","location":"Gqeberha","employment_type":"Permanent","start_date":"Feb 2019","end_date":null,"is_current":true,"description":"Design lead on bridge rehabilitation and highway structures.","achievements":"Led the structural design on a national route bridge rehabilitation delivered fully in BIM."},
    {"title":"Structural Engineer","company":"Zutari","location":"Gqeberha","employment_type":"Permanent","start_date":"Jan 2014","end_date":"Jan 2019","is_current":false,"description":"Structural analysis and detailing across transport infrastructure projects.","achievements":null}
  ]'::jsonb,
  education = '[
    {"qualification":"BEng","field":"Civil Engineering","institution":"Nelson Mandela University","year":"2013"}
  ]'::jsonb
where id = 'deadbee1-0000-4000-8000-00000000000c';

-- --- Finance ----------------------------------------------------------------

update public.candidates set
  phone = '+27 82 990 4416',
  linkedin_url = 'https://www.linkedin.com/in/michelle-van-wyk-ca',
  languages = ARRAY['Afrikaans','English']::text[],
  qualifications = ARRAY['BCom Accounting Honours','Certificate in the Theory of Accounting']::text[],
  professional_summary = 'Chartered accountant with thirteen years across audit, group finance and controllership. Runs monthly close, statutory reporting and the external audit relationship for a listed group. Works in SAP FICO and reports out of Power BI.',
  work_experience = '[
    {"title":"Financial Controller","company":"Bidvest Group","location":"Johannesburg","employment_type":"Permanent","start_date":"Mar 2019","end_date":null,"is_current":true,"description":"Owns group close, statutory reporting and the external audit relationship.","achievements":"Took the group close from twelve working days to seven."},
    {"title":"Finance Manager","company":"Nampak","location":"Johannesburg","employment_type":"Permanent","start_date":"Jan 2015","end_date":"Feb 2019","is_current":false,"description":"Divisional management accounts, budgeting and forecasting.","achievements":null},
    {"title":"Audit Senior","company":"PwC","location":"Johannesburg","employment_type":"Permanent","start_date":"Jan 2013","end_date":"Dec 2014","is_current":false,"description":"External audit across manufacturing and retail clients, completing articles.","achievements":null}
  ]'::jsonb,
  education = '[
    {"qualification":"BCom Honours","field":"Accounting","institution":"Stellenbosch University","year":"2012"},
    {"qualification":"BCom","field":"Accounting","institution":"Stellenbosch University","year":"2011"}
  ]'::jsonb
where id = 'deadbee1-0000-4000-8000-00000000000d';

update public.candidates set
  phone = '+27 78 552 3390',
  linkedin_url = 'https://www.linkedin.com/in/tebogo-radebe-cfa',
  languages = ARRAY['English','Setswana','Sesotho']::text[],
  qualifications = ARRAY['BCom Investment Management']::text[],
  professional_summary = 'Financial analyst and CFA charterholder with five years in asset management and investment banking. Builds valuation and forecasting models, and produces the analysis behind investment committee papers. Strong in Excel and increasingly in SQL.',
  work_experience = '[
    {"title":"Financial Analyst","company":"Rand Merchant Bank","location":"Sandton","employment_type":"Permanent","start_date":"Mar 2023","end_date":null,"is_current":true,"description":"Valuation and forecasting analysis supporting deal teams.","achievements":"Built the sector model now used as the desk standard for mid-market valuations."},
    {"title":"Investment Analyst","company":"Coronation Fund Managers","location":"Cape Town","employment_type":"Permanent","start_date":"Feb 2021","end_date":"Feb 2023","is_current":false,"description":"Equity research and portfolio analytics.","achievements":null}
  ]'::jsonb,
  education = '[
    {"qualification":"BCom","field":"Investment Management","institution":"University of Johannesburg","year":"2020"}
  ]'::jsonb
where id = 'deadbee1-0000-4000-8000-00000000000e';

update public.candidates set
  phone = '+27 84 337 1129',
  linkedin_url = 'https://www.linkedin.com/in/yusuf-ebrahim-acca',
  languages = ARRAY['English','Afrikaans']::text[],
  qualifications = ARRAY['BCom Accounting']::text[],
  professional_summary = 'Auditor with eight years across external audit and public sector assurance. ACCA qualified, with experience of regularity audits and the reporting that follows them. Has led audit teams of up to six.',
  work_experience = '[
    {"title":"Auditor","company":"Mazars South Africa","location":"Cape Town","employment_type":"Permanent","start_date":"Jun 2021","end_date":null,"is_current":true,"description":"Leads external and public sector audit engagements.","achievements":"Ran the regularity audit for a metropolitan entity that had been qualified for three years running, and closed the findings."},
    {"title":"Audit Senior","company":"BDO South Africa","location":"Cape Town","employment_type":"Permanent","start_date":"Jan 2018","end_date":"May 2021","is_current":false,"description":"External audit across retail and services clients.","achievements":null}
  ]'::jsonb,
  education = '[
    {"qualification":"BCom","field":"Accounting","institution":"University of Cape Town","year":"2017"}
  ]'::jsonb
where id = 'deadbee1-0000-4000-8000-00000000000f';

-- --- Healthcare -------------------------------------------------------------

update public.candidates set
  phone = '+27 72 118 6647',
  linkedin_url = 'https://www.linkedin.com/in/naledi-moloi-rn',
  languages = ARRAY['English','Sesotho','Afrikaans','isiZulu']::text[],
  qualifications = ARRAY['Bachelor of Nursing Science']::text[],
  professional_summary = 'Registered nurse with nine years across public and private acute care. Works in high care and theatre, and has been a super-user on two electronic medical record rollouts. Holds current BLS and ACLS certification.',
  work_experience = '[
    {"title":"Registered Nurse","company":"Netcare Universitas Hospital","location":"Bloemfontein","employment_type":"Permanent","start_date":"Feb 2020","end_date":null,"is_current":true,"description":"High care and theatre nursing, and clinical super-user on the EMR rollout.","achievements":"Trained 60 nursing staff through the electronic records go-live."},
    {"title":"Professional Nurse","company":"Pelonomi Tertiary Hospital","location":"Bloemfontein","employment_type":"Permanent","start_date":"Jan 2017","end_date":"Jan 2020","is_current":false,"description":"General ward and casualty nursing.","achievements":null}
  ]'::jsonb,
  education = '[
    {"qualification":"Bachelor of Nursing Science","field":"Nursing","institution":"University of the Free State","year":"2016"}
  ]'::jsonb
where id = 'deadbee1-0000-4000-8000-000000000010';

update public.candidates set
  phone = '+27 83 447 2205',
  available_from = '2027-01-31',
  linkedin_url = 'https://www.linkedin.com/in/dr-ayanda-cele',
  languages = ARRAY['English','isiZulu']::text[],
  qualifications = ARRAY['MBChB','MBA Healthcare Management']::text[],
  professional_summary = 'Clinical manager and medical doctor with fifteen years spanning clinical practice and hospital management. Runs clinical governance for a private hospital group and has led two electronic records implementations. Currently committed and not available for new engagements.',
  work_experience = '[
    {"title":"Clinical Manager","company":"Life Healthcare","location":"Durban","employment_type":"Permanent","start_date":"Jul 2018","end_date":null,"is_current":true,"description":"Clinical governance, quality and the clinical side of systems implementations.","achievements":"Led the Cerner implementation across three hospitals in the eastern region."},
    {"title":"Medical Officer","company":"Addington Hospital","location":"Durban","employment_type":"Permanent","start_date":"Jan 2011","end_date":"Jun 2018","is_current":false,"description":"Clinical practice across internal medicine and casualty.","achievements":null}
  ]'::jsonb,
  education = '[
    {"qualification":"MBA","field":"Healthcare Management","institution":"University of KwaZulu-Natal","year":"2017"},
    {"qualification":"MBChB","field":"Medicine","institution":"University of KwaZulu-Natal","year":"2010"}
  ]'::jsonb
where id = 'deadbee1-0000-4000-8000-000000000011';

-- --- Marketing / HR / Executive ---------------------------------------------

update public.candidates set
  phone = '+27 74 226 8801',
  linkedin_url = 'https://www.linkedin.com/in/chloe-adams-digital',
  languages = ARRAY['English','Afrikaans']::text[],
  qualifications = ARRAY['BA Media and Communication']::text[],
  professional_summary = 'Digital marketing specialist with six years in e-commerce and retail. Runs paid search and paid social end to end, and owns the reporting that sits behind it. Google Ads and HubSpot certified.',
  work_experience = '[
    {"title":"Digital Marketing Specialist","company":"Superbalist","location":"Cape Town","employment_type":"Permanent","start_date":"Apr 2022","end_date":null,"is_current":true,"description":"Owns paid search and paid social, and the performance reporting behind them.","achievements":"Grew return on ad spend by 38 percent over two trading seasons."},
    {"title":"Marketing Coordinator","company":"Yuppiechef","location":"Cape Town","employment_type":"Permanent","start_date":"Jan 2020","end_date":"Mar 2022","is_current":false,"description":"Campaign execution, email marketing and content scheduling.","achievements":null}
  ]'::jsonb,
  education = '[
    {"qualification":"BA","field":"Media and Communication","institution":"Stellenbosch University","year":"2019"}
  ]'::jsonb
where id = 'deadbee1-0000-4000-8000-000000000012';

update public.candidates set
  phone = '+27 82 771 3358',
  linkedin_url = 'https://www.linkedin.com/in/precious-nkosi-hr',
  languages = ARRAY['English','isiZulu','Setswana']::text[],
  qualifications = ARRAY['BCom Human Resource Management']::text[],
  professional_summary = 'HR manager with eleven years across industrial and consumer goods. Covers employee relations, talent acquisition and performance management, and has handled CCMA matters directly. Marked inactive on our records pending a status update.',
  work_experience = '[
    {"title":"HR Manager","company":"Sasol","location":"Johannesburg","employment_type":"Permanent","start_date":"Mar 2019","end_date":null,"is_current":true,"description":"Generalist HR management for an operating division of about 900 staff.","achievements":"Reduced average time to hire from 71 days to 44."},
    {"title":"HR Business Partner","company":"Tiger Brands","location":"Johannesburg","employment_type":"Permanent","start_date":"Jan 2015","end_date":"Feb 2019","is_current":false,"description":"Business partnering across manufacturing sites.","achievements":null}
  ]'::jsonb,
  education = '[
    {"qualification":"BCom","field":"Human Resource Management","institution":"University of South Africa","year":"2014"}
  ]'::jsonb
where id = 'deadbee1-0000-4000-8000-000000000013';

update public.candidates set
  phone = '+27 82 401 9963',
  linkedin_url = 'https://www.linkedin.com/in/gerhard-steyn-cfo',
  languages = ARRAY['Afrikaans','English']::text[],
  qualifications = ARRAY['BCom Accounting Honours','MBA']::text[],
  professional_summary = 'Chief financial officer with twenty-four years in listed and private groups. Has taken one group through a JSE listing and led four acquisitions from due diligence to integration. Sits on two boards as a non-executive director.',
  work_experience = '[
    {"title":"Chief Financial Officer","company":"Adcorp Holdings","location":"Sandton","employment_type":"Permanent","start_date":"Jan 2016","end_date":null,"is_current":true,"description":"Group finance, investor relations and corporate transactions.","achievements":"Led four acquisitions from due diligence through to integration, and refinanced the group debt facility on materially better terms."},
    {"title":"Group Financial Manager","company":"Barloworld","location":"Johannesburg","employment_type":"Permanent","start_date":"Feb 2008","end_date":"Dec 2015","is_current":false,"description":"Group reporting, treasury and consolidation across the divisions.","achievements":null},
    {"title":"Audit Manager","company":"KPMG","location":"Johannesburg","employment_type":"Permanent","start_date":"Jan 2002","end_date":"Jan 2008","is_current":false,"description":"External audit across industrial and listed clients.","achievements":null}
  ]'::jsonb,
  education = '[
    {"qualification":"MBA","field":"Business Administration","institution":"University of Cape Town Graduate School of Business","year":"2010"},
    {"qualification":"BCom Honours","field":"Accounting","institution":"University of Pretoria","year":"2001"}
  ]'::jsonb
where id = 'deadbee1-0000-4000-8000-000000000014';

-- ---------------------------------------------------------------------------
-- Verify. All 20 demo candidates should report complete on every column.
-- ---------------------------------------------------------------------------
select
  count(*)                                                          as demo_candidates,
  count(*) filter (where phone is not null)                         as with_phone,
  count(*) filter (where professional_summary is not null)          as with_summary,
  count(*) filter (where linkedin_url is not null)                  as with_linkedin,
  count(*) filter (where jsonb_array_length(work_experience) > 0)   as with_experience,
  count(*) filter (where jsonb_array_length(education) > 0)         as with_education,
  count(*) filter (where cardinality(languages) > 0)                as with_languages,
  count(*) filter (where cardinality(qualifications) > 0)           as with_qualifications,
  -- Expect exactly 4, the forward-availability spread described at the top.
  count(*) filter (where available_from is not null)                as with_available_from
from public.candidates
where id::text like 'deadbee1-%';
