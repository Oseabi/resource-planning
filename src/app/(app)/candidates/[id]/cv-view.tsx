import { Link2, Globe, Mail, Phone, MapPin, CalendarClock } from "lucide-react";
import { AvailabilityBadge, Chip } from "@/app/(app)/candidates/candidate-badges";
import { availabilityLabel, INDEFINITE, type FreeFrom } from "@/lib/availability";
import { formatLongDate } from "@/lib/dates";
import { durationOf, lineKinds } from "@/lib/cv-record";
import type { Database } from "@/lib/supabase/database.types";

type Candidate = Database["public"]["Tables"]["candidates"]["Row"];

/**
 * A candidate's record laid out as the issued TiPP CV is: the same sections,
 * in the same order, under the same names, so somebody holding the PDF can
 * check the record against it top to bottom. Pure: given the row, renders
 * it, which is what lets the order be asserted in a test without a browser
 * or a session.
 */
export function CandidateCvView({ candidate, freeFrom }: { candidate: Candidate; freeFrom: FreeFrom | null }) {
  return (
    <>
      {/* From here the page reads as the issued TiPP CV does, section by
          section in its order and under its names, so somebody holding the
          PDF can check the record against it top to bottom. The system's
          own sections come after. */}

      {/* 1. The header table */}
      <Card title="Candidate details">
        <LabelTable
          rows={[
            ["Full name", candidate.full_name],
            // Printed on the TiPP CV, so shown as the template prints it.
            ["Date of birth", formatLongDate(candidate.date_of_birth)],
            ["Position", candidate.current_role],
            ["Designated group", candidate.designated_group],
            ["Years of experience", candidate.years_experience != null ? `${candidate.years_experience} years` : null],
            [
              "Availability",
              <span key="availability" className="inline-flex flex-wrap items-center gap-2">
                <AvailabilityBadge availability={candidate.availability} />
                {candidate.availability_note && <span>{candidate.availability_note}</span>}
                {freeFrom !== null && (
                  <span className={freeFrom === INDEFINITE ? "text-muted-foreground" : ""}>
                    <CalendarClock className="mr-1 inline size-4 text-muted-foreground" />
                    {availabilityLabel(freeFrom)}
                  </span>
                )}
              </span>,
            ],
            ["Languages", candidate.languages.length ? candidate.languages.join(", ") : null],
            // When the CV this was read from was last confirmed. Shown, not policed.
            ["CV as of", formatLongDate(candidate.cv_as_of)],
          ]}
        />
      </Card>

      {/* Not on the CV; kept high because it is short and it is how the
          person is reached. */}
      {(candidate.email || candidate.phone || candidate.location || candidate.linkedin_url || candidate.portfolio_url) && (
        <Card title="Contact">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <IconLine icon={<Mail className="size-4" />} value={candidate.email} />
            <IconLine icon={<Phone className="size-4" />} value={candidate.phone} />
            <IconLine icon={<MapPin className="size-4" />} value={candidate.location} />
            <IconLine icon={<Link2 className="size-4" />} value={candidate.linkedin_url} href={candidate.linkedin_url} />
            <IconLine icon={<Globe className="size-4" />} value={candidate.portfolio_url} href={candidate.portfolio_url} />
          </div>
        </Card>
      )}

      {/* 2. CANDIDATE OVERVIEW */}
      <Card title="Candidate overview">
        {candidate.professional_summary ? (
          <p className="whitespace-pre-wrap text-body-md text-foreground">{candidate.professional_summary}</p>
        ) : (
          <Blank>No summary yet.</Blank>
        )}
      </Card>

      {/* 3. CAREER SUMMARY, derived from the employment history the way the
          template's own table is. */}
      <Card title="Career summary">
        {candidate.work_experience.length > 0 ? (
          <GridTable
            headers={["Company", "Position", "Duration"]}
            rows={candidate.work_experience.map((exp) => [exp.company, exp.title, durationOf(exp)])}
          />
        ) : (
          <Blank>No employment recorded.</Blank>
        )}
      </Card>

      {/* 4. QUALIFICATIONS */}
      <Card title="Qualifications">
        {candidate.education.length > 0 ? (
          <GridTable
            headers={["Qualification", "Institution", "Year"]}
            rows={candidate.education.map((edu) => [edu.qualification, edu.institution, edu.year])}
          />
        ) : candidate.qualifications.length > 0 ? (
          <Chips tags={candidate.qualifications} />
        ) : (
          <Blank>No qualifications recorded.</Blank>
        )}
      </Card>

      {/* 5. CERTIFICATES AND COURSES. The flat names only when there is no
          detailed row, since every detailed row is in the flat list too. */}
      {(candidate.certificates.length > 0 || candidate.certifications.length > 0) && (
        <Card title="Certificates and courses">
          {candidate.certificates.length > 0 ? (
            <GridTable
              headers={["Certificate or course", "Institution", "Year"]}
              rows={candidate.certificates.map((c) => [c.name, c.institution ?? null, c.year ?? null])}
            />
          ) : (
            <Chips tags={candidate.certifications} />
          )}
        </Card>
      )}

      {/* 6. SKILLSET */}
      <Card title="Skillset">
        {candidate.skill_matrix.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="text-left text-label-sm uppercase tracking-wide text-muted-foreground">
                  <th className="py-1.5 pr-4 font-medium">Skills</th>
                  <th className="py-1.5 pr-4 font-medium">Proficiency</th>
                  <th className="py-1.5 font-medium">Years of experience</th>
                </tr>
              </thead>
              <tbody>
                {candidate.skill_matrix.map((cat) => {
                  const years = sharedYears(cat.skills);
                  return (
                    <tr key={cat.category} className="border-t border-border align-top">
                      <td className="w-48 py-2 pr-4 font-medium text-foreground">{cat.category}</td>
                      <td className="py-2 pr-4 text-foreground">
                        {cat.skills
                          .map((s) => (years === undefined && s.years ? `${s.name} (${s.years})` : s.name))
                          .join("; ")}
                      </td>
                      <td className="whitespace-nowrap py-2 text-muted-foreground">{years ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : candidate.technical_skills.length + candidate.skills.length > 0 ? (
          <Chips tags={[...candidate.technical_skills, ...candidate.skills]} />
        ) : (
          <Blank>No skills recorded.</Blank>
        )}
      </Card>

      {/* 7. PROJECTS, 8. ACHIEVEMENTS: printed only when the CV had them. */}
      {candidate.projects.length > 0 && (
        <Card title="Projects">
          <GridTable
            headers={["Company name", "Project name"]}
            rows={candidate.projects.map((g) => [g.company, g.projects.join("\n")])}
          />
        </Card>
      )}

      {candidate.achievements && (
        <Card title="Achievements">
          <Lines text={candidate.achievements} />
        </Card>
      )}

      {/* 9. EMPLOYMENT HISTORY, one block per job laid out as the template's
          Company / Client / Role / Duration / Duties rows. */}
      <Card title="Employment history">
        {candidate.work_experience.length === 0 ? (
          <Blank>No employment recorded.</Blank>
        ) : (
          <div className="space-y-5">
            {candidate.work_experience.map((exp, i) => (
              <div key={i} className={i > 0 ? "border-t border-border pt-5" : ""}>
                <LabelTable
                  rows={[
                    ["Company", exp.company],
                    ["Client", exp.client ?? null],
                    ["Role", exp.title],
                    ["Duration", durationOf(exp) || null],
                    ["Location", [exp.location, exp.employment_type].filter(Boolean).join(" · ") || null],
                  ]}
                />
                {exp.description && (
                  <div className="mt-3">
                    <div className="text-label-sm font-medium text-muted-foreground">Duties</div>
                    <Lines text={exp.description} />
                  </div>
                )}
                {exp.achievements && (
                  <div className="mt-3">
                    <div className="text-label-sm font-medium text-muted-foreground">Key achievements</div>
                    <p className="mt-1 whitespace-pre-wrap text-body-sm text-foreground">{exp.achievements}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

    </>
  );
}

/**
 * A duties cell or an achievements box as the CV prints it: bullets
 * indented, and a line that was not a bullet on the CV as a bold
 * sub-heading. Text without any bullet marks is all bullets.
 */
function Lines({ text }: { text: string }) {
  return (
    <div className="mt-1 space-y-0.5 text-body-sm text-foreground">
      {lineKinds(text).map((line, i) =>
        line.kind === "heading" ? (
          <div key={i} className={"font-medium" + (i > 0 ? " pt-2" : "")}>
            {line.text}
          </div>
        ) : (
          <div key={i} className="flex gap-2 pl-4">
            <span aria-hidden="true">{"\u2022"}</span>
            <span>{line.text}</span>
          </div>
        ),
      )}
    </div>
  );
}

/** The years shown for a whole skills row when every skill in it agrees; undefined otherwise. */
function sharedYears(skills: { years?: string | null }[]): string | null | undefined {
  const values = new Set(skills.map((s) => s.years?.trim() || null));
  return values.size === 1 ? [...values][0] : undefined;
}

export function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card shadow-card p-5">
      {title && <h2 className="mb-2 text-label-sm uppercase tracking-wide text-muted-foreground">{title}</h2>}
      {children}
    </div>
  );
}

/** The template's label-and-value rows. A row with nothing in it is left out. */
function LabelTable({ rows }: { rows: [string, React.ReactNode][] }) {
  const shown = rows.filter(([, value]) => value !== null && value !== undefined && value !== "");
  if (shown.length === 0) return null;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-body-sm sm:grid-cols-[12rem_1fr]">
      {shown.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="font-medium text-muted-foreground">{label}</dt>
          <dd className="min-w-0 text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A table as the template prints one: headers, then rows, blanks shown blank. */
function GridTable({ headers, rows }: { headers: string[]; rows: (string | null | undefined)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-body-sm">
        <thead>
          <tr className="text-left text-label-sm uppercase tracking-wide text-muted-foreground">
            {headers.map((h) => (
              <th key={h} className="py-1.5 pr-4 font-medium last:pr-0">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-border align-top">
              {row.map((cell, j) => (
                <td key={j} className="whitespace-pre-line py-2 pr-4 text-foreground last:pr-0">
                  {cell ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Chips({ tags }: { tags: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <Chip key={t}>{t}</Chip>
      ))}
    </div>
  );
}

function IconLine({ icon, value, href }: { icon: React.ReactNode; value: string | null; href?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex min-w-0 items-center gap-2 text-body-md text-foreground">
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      {href ? (
        <a href={href.startsWith("http") ? href : `https://${href}`} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-primary hover:underline">
          {value}
        </a>
      ) : (
        <span className="min-w-0 truncate">{value}</span>
      )}
    </div>
  );
}

/** A section the template always prints, with nothing in it yet. */
function Blank({ children }: { children: React.ReactNode }) {
  return <p className="text-body-sm text-muted-foreground">{children}</p>;
}
