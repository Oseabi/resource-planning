-- ============================================================================
-- Demo dataset, 14 OEM authorisation letters.
-- Paste this whole file into the Supabase dashboard SQL Editor and click "Run".
--
-- Purpose: the compliance side of the app is invisible with an empty table. The
-- dashboard risk tile reads 0, Compliance watch says nothing is expiring, and
-- the vendor and practice-area folders do not exist at all. This gives every one
-- of those surfaces something real to show.
--
-- Vendors are taken from OEM_VENDORS in src/lib/oem-letters.ts and categories
-- from CATEGORY_NAMES in src/lib/resource-categories.ts. Both matter: the folder
-- view groups on the exact string, so an invented category would split into its
-- own folder and the practice-area grouping would look broken.
--
-- Vendors are also chosen to line up with the seeded tenders, so a walkthrough
-- can go from a bid to the letters that back it: Microsoft and SAP for the ERP
-- bids, Autodesk and Siemens for the SANRAL and Growthpoint construction bids,
-- AWS and VMware for the cloud programme, Fortinet and Cisco for security.
--
-- Every demo row uses a fixed UUID on the 'deadbee4-' prefix so
-- supabase/seed_demo_cleanup.sql can remove all of it in one pass without
-- touching your real records.
--
-- Self-contained and idempotent: safe to re-run.
--
-- NOTE: no files are attached. file_path only drives a small paperclip icon in
-- the list, so folders, badges, counts and the dashboard all work without
-- uploading anything.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Expiry spread, measured against the date you run this.
--
-- The 60-day warning window lives in EXPIRY_WARNING_DAYS (src/lib/oem-letters.ts).
-- These dates are fixed rather than relative to now(), matching how the tender
-- deadlines in seed_demo.sql are written, so what you see stays reproducible.
--
--   2 expired          red badges, the dashboard risk tile, red folder counts
--   3 expiring soon    amber badges, populates Compliance watch
--   8 valid            the normal case
--   1 no expiry set    exercises the "unknown" badge
--
-- One letter (Dell) is deliberately left with no practice area, so the
-- "N letters with no practice area" hint on the category tab has something to
-- report.
-- ---------------------------------------------------------------------------

insert into public.oem_letters (
  id, title, oem_vendor, categories, reference_number, issued_to,
  issue_date, expiry_date, notes
) values

-- --- Expired ---------------------------------------------------------------
('deadbee4-0000-4000-8000-000000000001',
 'Cisco Premier Partner authorisation', 'Cisco',
 ARRAY['Cybersecurity','Cloud & DevOps']::text[],
 'CIS-ZA-2025-4471', 'TiPP Focus Holdings (Pty) Ltd',
 '2025-06-01', '2026-05-31',
 'Lapsed. Renewal was submitted through the distributor and is still outstanding. Do not attach to a live bid until the replacement letter is on file.'),

('deadbee4-0000-4000-8000-000000000002',
 'Mimecast email security reseller letter', 'Mimecast',
 ARRAY['Cybersecurity']::text[],
 'MIM-ZA-2025-0882', 'TiPP Focus Holdings (Pty) Ltd',
 '2025-07-16', '2026-07-15',
 'Lapsed last month. Low priority, no current bid depends on it.'),

-- --- Expiring soon ---------------------------------------------------------
('deadbee4-0000-4000-8000-000000000003',
 'Microsoft Dynamics 365 Finance and Operations partner authorisation', 'Microsoft',
 ARRAY['ERP','Cloud & DevOps']::text[],
 'MS-ZA-2025-11824', 'TiPP Focus Holdings (Pty) Ltd',
 '2025-08-29', '2026-08-28',
 'Backs the Department of Public Works ERP bid. Renew before the submission date or the bid loses its OEM backing.'),

('deadbee4-0000-4000-8000-000000000004',
 'SAP S/4HANA implementation partner letter', 'SAP',
 ARRAY['ERP','Finance & Accounting']::text[],
 'SAP-ZA-2025-3390', 'TiPP Focus Holdings (Pty) Ltd',
 '2025-09-19', '2026-09-18',
 'Required for the Transnet S/4HANA finance migration. Renewal request logged with the SAP partner desk.'),

('deadbee4-0000-4000-8000-000000000005',
 'Autodesk AutoCAD Civil 3D authorised reseller letter', 'Autodesk',
 ARRAY['Construction & Engineering']::text[],
 'ADSK-ZA-2025-7712', 'TiPP Focus Holdings (Pty) Ltd',
 '2025-10-06', '2026-10-05',
 'Supports the SANRAL bridge rehabilitation and Growthpoint fit-out bids.'),

-- --- Valid -----------------------------------------------------------------
('deadbee4-0000-4000-8000-000000000006',
 'AWS Advanced Consulting Partner authorisation', 'Amazon Web Services',
 ARRAY['Cloud & DevOps']::text[],
 'AWS-ZA-2026-0145', 'TiPP Focus Holdings (Pty) Ltd',
 '2026-02-01', '2027-01-31',
 'Covers the cloud migration and DevOps enablement programme.'),

('deadbee4-0000-4000-8000-000000000007',
 'VMware cloud infrastructure partner letter', 'VMware',
 ARRAY['Cloud & DevOps']::text[],
 'VMW-ZA-2026-0233', 'TiPP Focus Holdings (Pty) Ltd',
 '2026-04-01', '2027-03-31',
 null),

('deadbee4-0000-4000-8000-000000000008',
 'Oracle database and analytics partner authorisation', 'Oracle',
 ARRAY['Data & BI','ERP']::text[],
 'ORA-ZA-2026-5518', 'TiPP Focus Holdings (Pty) Ltd',
 '2026-05-16', '2027-05-15',
 'Covers both the database estate and Oracle Analytics Cloud.'),

('deadbee4-0000-4000-8000-000000000009',
 'Fortinet network security authorisation', 'Fortinet',
 ARRAY['Cybersecurity']::text[],
 'FTNT-ZA-2026-0917', 'TiPP Focus Holdings (Pty) Ltd',
 '2026-07-01', '2027-06-30',
 'Replaces the lapsed Cisco security cover for bids that allow either vendor.'),

('deadbee4-0000-4000-8000-00000000000a',
 'ServiceNow ITSM implementation partner letter', 'ServiceNow',
 ARRAY['Project & Programme Management','Business Analysis']::text[],
 'SNOW-ZA-2026-1204', 'TiPP Focus Holdings (Pty) Ltd',
 '2026-09-01', '2027-08-31',
 'Issued ahead of the Eskom programme management office bid.'),

('deadbee4-0000-4000-8000-00000000000b',
 'Microsoft Power BI and Azure data platform authorisation', 'Microsoft',
 ARRAY['Data & BI','Cloud & DevOps']::text[],
 'MS-ZA-2026-12907', 'TiPP Focus Holdings (Pty) Ltd',
 '2026-12-01', '2027-11-30',
 'Separate from the Dynamics letter. Data platform work is authorised under this one.'),

('deadbee4-0000-4000-8000-00000000000c',
 'Dell hardware supply authorisation', 'Dell',
 ARRAY[]::text[],
 'DELL-ZA-2027-0031', 'TiPP Focus Holdings (Pty) Ltd',
 '2027-02-01', '2028-01-31',
 'Hardware supply only, no practice area attached. Tag it if a bid needs it categorised.'),

('deadbee4-0000-4000-8000-00000000000d',
 'Siemens building automation partner letter', 'Siemens',
 ARRAY['Construction & Engineering']::text[],
 'SIE-ZA-2027-0664', 'TiPP Focus Holdings (Pty) Ltd',
 '2027-04-01', '2028-03-31',
 null),

-- --- No expiry recorded ----------------------------------------------------
('deadbee4-0000-4000-8000-00000000000e',
 'IBM integration and enterprise architecture partner letter', 'IBM',
 ARRAY['Enterprise Architecture (EA)','Software Development']::text[],
 'IBM-ZA-2026-0450', 'TiPP Focus Holdings (Pty) Ltd',
 '2026-03-15', null,
 'Open-ended letter with no stated expiry. Confirm with IBM before relying on it in a submission, since most evaluators expect a date.')

on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Verify. Expect 2 expired, 3 expiring soon, 8 valid, 1 with no expiry.
-- ---------------------------------------------------------------------------
select
  case
    when expiry_date is null then 'no expiry set'
    when expiry_date < current_date then 'expired'
    when expiry_date <= current_date + 60 then 'expiring soon'
    else 'valid'
  end as bucket,
  count(*) as letters
from public.oem_letters
where id::text like 'deadbee4-%'
group by 1
order by 1;
