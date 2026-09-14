-- Reference letters filed in folders, and labelled by what they are.
--
-- The letters came out of the bid team's archive already sorted into
-- folders by practice area (EA, ERP, SAP, SharePoint, ITSM and so on), and
-- that is how a bid writer looks for one: "the EA references", not a flat
-- list of eighty. The folder is a plain label on the row rather than a
-- table of its own, because a folder is only a name and a letter is in one
-- of them; the form offers the names already in use.
--
-- Not everything in the archive is a client reference. Some are award or
-- appointment letters (proof of a contract, with nobody vouching for the
-- work) and some are confirmations that a supplier is on the books. They
-- belong on file, since a bid pack often attaches them, but a tender that
-- asks for three references is not answered by an award letter, so the
-- kind is recorded and coverage counts references only.
--
-- Self-contained and idempotent: safe to re-run.

alter table public.reference_letters
  add column if not exists folder text,
  add column if not exists kind text not null default 'reference';

alter table public.reference_letters
  drop constraint if exists reference_letters_kind_check;

alter table public.reference_letters
  add constraint reference_letters_kind_check
  check (kind in ('reference', 'award', 'confirmation'));

comment on column public.reference_letters.folder is
  'Where the letter is filed, by practice area. Null is unfiled.';

comment on column public.reference_letters.kind is
  'reference: a client vouching for delivered work. award: an award, appointment or offer letter. confirmation: a client confirming an appointment or supplier status without speaking to the work. Only references count toward a tender''s requirement.';

-- ---------------------------------------------------------------------------
-- File the letters loaded from the REFERENCES archive on 14 September 2026,
-- keyed by the stored file name. Only rows still unfiled, so a re-run never
-- undoes a move somebody made since.
-- ---------------------------------------------------------------------------

update public.reference_letters
set folder = 'Business Analysis'
where folder is null
  and original_filename in (
    '020-_2024-IT-PANEL-PSL-02-RFQ_-_Award_Letter.pdf',
    'Reference_Department_of_the_Premier_Tipp_Focus_27_Feb_2025.pdf'
  );

update public.reference_letters
set folder = 'Data Analytics and BI'
where folder is null
  and original_filename in (
    'Reference_Letter_for_TippFocus.pdf',
    '20250922_KZN_Treasury_Tipp_Focus_Reference_Letter.pdf',
    'DoJ_IJS_Information_Research_and_Knowledge_Management_Reference_11_Mar_2021.pdf'
  );

update public.reference_letters
set folder = 'ERP'
where folder is null
  and original_filename in (
    'D365_-_ERP_Reference_Letter_-_DCoG.pdf',
    'Reference_letter_Tipp_Focus_ERP_13_Nov_2025.pdf',
    'D365_-_ERP_Reference_Letter_-_National_Skills_Fund.pdf',
    '2020_WRSETA.pdf',
    'ACSA_Oracle_ERP_Reference_25_Jun_2019.pdf'
  );

update public.reference_letters
set folder = 'Enterprise Architecture'
where folder is null
  and original_filename in (
    'Tipp_Focus_Holdings_Reference_Letter_EA_Project_at_SASSA.pdf',
    '7._2019_DPW_Letter_-_Copy.pdf',
    '2019_CIDB_Letter.pdf',
    'Reference_Letter_for_TippFocus_22_May_2026.pdf',
    'Tipp_Focus_Holdings_Reference_Letter_EA_Project_for_DoJ__002_.pdf',
    'Tipp_Focus_Holdings_Refernce_letter_-_Prasa.pdf',
    'Tipp_Focus_Holdings_Reference_Letter_30_July_2025.pdf',
    'DoJ_IJS_EA_and_BPM_Reference_09_Dec_2024.pdf',
    'DSD_EA_and_BPM_Reference_05_Dec_2024.pdf',
    'OVG_EA_Plan_and_Roadmap_Reference_02_Dec_2024.pdf',
    'Jicho_Consulting_EA_and_BPM_Reference_02_Dec_2024.pdf',
    'Software_AG_Partner_Reference_30_Jan_2017.pdf',
    'HDA_Business_Process_Architecture_Reference_24_Jan_2017.pdf',
    'EMM_Enterprise_Architecture_Reference_24_Jan_2017.pdf',
    'DoJ_IJS_Strategy_Development_Reference_11_Mar_2021.pdf',
    'DoJ_IJS_Enterprise_Architecture_Reference_11_Mar_2021.pdf'
  );

update public.reference_letters
set folder = 'Enterprise Content Management'
where folder is null
  and original_filename in (
    '2._ECM_DoJ.pdf',
    '3._ECM_Dept_of_Social_Development.pdf',
    '4._ECM_Deeds.pdf'
  );

update public.reference_letters
set folder = 'ICT Infrastructure and Support'
where folder is null
  and original_filename in (
    'Deeds_Reference_Tipp_Focus_MIMECAST_AND_VEAM.pdf',
    '2017_DPW_Letter__1_.pdf',
    '2._DPWI_-_Provision_of_ICT_Services___Resources_-_Copy.pdf',
    '6._SAFCOL.pdf',
    'TippFocus_DPE_Reference_Letter.pdf',
    'FTSEZ_-_ICT_INFRASTRUCTURE.pdf',
    '3._CETA_-__ICT_Infrastructure_Services.pdf',
    'CETA_Reference_Letter_09_May_2018.pdf',
    'DoJ_IJS_Network_Management_Reference_11_Mar_2021.pdf',
    'DoJ_IJS_Server_Infrastructure_Reference_11_Mar_2021.pdf',
    'DPW_IT_Support_Reference_17_Sep_2015.pdf',
    'EMM_Exchange_2013_Upgrade_Reference_15_Sep_2015.pdf',
    'CETA_Offer_to_Contract_Bid_029-2015-2016_23_Mar_2016.pdf'
  );

update public.reference_letters
set folder = 'ICT Professional Services'
where folder is null
  and original_filename in (
    'Tipp_Focus_Reference_Letter_-_8_Jul_26_LM.pdf',
    'DoJ_CD_REFERENCE_LETTER.._-_July_2025..pdf',
    '1._Tipp_Focus_Reference_letter_2_BI_and_Cyber_Security.pdf',
    'DPW_Application_Operations_Services_Reference.pdf',
    '5._GPAA_-__ICT_Resources___Project_Management.pdf',
    '2020_IJS_Letter.pdf',
    'ACSA_Ref_Letters-10.pdf',
    'TFH_-_RFP202704_-_Appointment_of_a_Panel.pdf',
    'DoJ_IJS_Project_Management_Reference_11_Mar_2021.pdf',
    'City_of_Cape_Town_Tender_44S-2018-19_Award_15_May_2019.pdf'
  );

update public.reference_letters
set folder = 'IT Service Management'
where folder is null
  and original_filename in (
    'ITSM_-_16-10-2025_b.pdf',
    'Rural_Development_-_ITSM.pdf',
    'DOJ_-_ITSM.pdf',
    'PPRA_-_ITSM.pdf'
  );

update public.reference_letters
set folder = 'Resourcing'
where folder is null
  and original_filename in (
    'Tipp_Focus_Resourcing-_Referral_Letter_Sep_2026.pdf'
  );

update public.reference_letters
set folder = 'SAP'
where folder is null
  and original_filename in (
    'Reference_Letter_TIPP_Focus_Group_City_of_Cape_Town_-_Copy.pdf',
    'PTPI_Tipp_Focus_JV__Pty__Ltd_Reference_Letter.pdf',
    'City_of_Cape_Town_ICT_Professional_Services_Reference_11_Jul_2024.pdf',
    'DWS_Intention_to_Award_WQ_12076_27_Nov_2024.pdf'
  );

update public.reference_letters
set folder = 'SharePoint and Microsoft 365'
where folder is null
  and original_filename in (
    '2017_IJS_MS_Letter.pdf',
    '2016_PTPI.pdf',
    '2017_EMM_MS_Letter.pdf',
    'R13_DOJ_CD_-_Microsoft_SharePoint_Services___Support.pdf',
    'R6_CATHSSETA_-_Solution_Training.pdf'
  );

update public.reference_letters
set folder = 'Software Development'
where folder is null
  and original_filename in (
    'Film_and_Publications_Board_Reference_Letter_.pdf',
    'Letter_20230818_Recommendation_TippFocus_ICT_Management_Services.pdf',
    '2020_DCS_Letter.pdf',
    'Sita_Reference.pdf',
    'Stats_SA_Ref_Letter.pdf',
    '1._2021_DOJ__CD_Development.pdf',
    '2._2021_DOJ__CD_Application_QA.pdf',
    'Reference_Letter_TIPP_Focus_DALRRD_S_Dlamini.pdf',
    'Reference_Letter_Western_Cape_Government__Department_of_Health___003_.pdf',
    'TIPP_FOCUS_20.pdf',
    'National_Treasury.pdf',
    'DCS_webMethods_Reference_16_May_2025.pdf'
  );

update public.reference_letters
set kind = 'confirmation'
where kind = 'reference'
  and original_filename in (
    'Tipp_Focus_Holdings_Reference_Letter_30_July_2025.pdf',
    'Tipp_Focus_Reference_Letter_-_8_Jul_26_LM.pdf'
  );

-- The importer wrote the award letters with notes beginning "AWARD LETTER".
update public.reference_letters
set kind = 'award'
where kind = 'reference'
  and notes like 'AWARD LETTER%';

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------

-- 1. One row per folder with its count; the archive gives twelve.
select coalesce(folder, '(unfiled)') as item, count(*)::text as detail
from public.reference_letters
group by folder
order by folder nulls last;

-- 2. One row per kind: reference, award, confirmation.
select kind as item, count(*)::text as detail
from public.reference_letters
group by kind
order by kind;
