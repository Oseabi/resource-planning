import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil, Link2, Globe, Mail, Phone, MapPin, Briefcase, GraduationCap, CalendarClock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/auth/current-user";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StatusBadge, AvailabilityBadge, Chip } from "@/app/(app)/candidates/candidate-badges";
import { availableFrom, availabilityLabel, INDEFINITE } from "@/lib/availability";
import { loadActivity } from "@/app/(app)/activity-actions";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { loadDeployments } from "@/lib/deployments-repo";
import { DeploymentsPanel } from "@/app/(app)/candidates/[id]/deployments-panel";
import { CvDownloadButton } from "@/app/(app)/candidates/[id]/cv-download-button";
import { DeleteCandidateButton } from "@/app/(app)/candidates/[id]/delete-candidate-button";

export default async function CandidateProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // isCurrentUserAdmin is request-cached: the layout has already resolved it, so
  // this adds no round-trip.
  const [{ data: candidate }, isAdmin, { data: placements }, activity, deployments] =
    await Promise.all([
      supabase.from("candidates").select("*").eq("id", id).single(),
      isCurrentUserAdmin(),
      supabase
        .from("placements")
        .select("candidate_id, start_date, end_date")
        .eq("candidate_id", id),
      loadActivity("candidate", id),
      loadDeployments(supabase, id),
    ]);

  if (!candidate) notFound();

  // The availability badge says what they are today; this says when they are
  // next free, which is the question anyone planning a bid team is asking.
  const freeFrom = availableFrom(candidate, placements ?? []);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/candidates" className="inline-flex items-center gap-1.5 text-body-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        Back to candidates
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-display font-semibold text-foreground">{candidate.full_name}</h1>
          <p className="mt-1 text-body-lg text-muted-foreground">
            {candidate.current_role ?? "No role set"}
            {candidate.location ? ` · ${candidate.location}` : ""}
          </p>
          {candidate.additional_roles.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {candidate.additional_roles.map((r) => (
                <Chip key={r}>{r}</Chip>
              ))}
            </div>
          )}
          {candidate.resource_categories.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {candidate.resource_categories.map((cat) => (
                <span
                  key={cat}
                  className="inline-flex items-center rounded-lg bg-primary/10 px-2 py-0.5 text-label-md font-medium text-primary"
                >
                  {cat}
                </span>
              ))}
            </div>
          )}
          <div className="mt-3 flex items-center gap-2">
            <StatusBadge status={candidate.status} />
            <AvailabilityBadge availability={candidate.availability} />
            {candidate.years_experience != null && (
              <span className="text-body-sm text-muted-foreground">{candidate.years_experience} yrs experience</span>
            )}
          </div>
          {freeFrom !== null && (
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-body-sm">
              <CalendarClock className="size-4 text-muted-foreground" />
              <span
                className={freeFrom === INDEFINITE ? "text-muted-foreground" : "text-foreground"}
              >
                {availabilityLabel(freeFrom)}
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {candidate.cv_file_path && (
            <CvDownloadButton path={candidate.cv_file_path} filename={candidate.cv_original_filename} />
          )}
          <Button variant="outline" size="sm" render={<Link href={`/candidates/${id}/edit`} />} nativeButton={false}>
            <Pencil className="size-4" />
            Edit
          </Button>
          {isAdmin && <DeleteCandidateButton candidateId={candidate.id} candidateName={candidate.full_name} />}
        </div>
      </div>

      {/* Above the tabs on purpose: "where is this person right now" is the
          first question anyone opening a profile is asking. */}
      <DeploymentsPanel deployments={deployments} />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="experience">Experience</TabsTrigger>
          <TabsTrigger value="education">Education &amp; Certifications</TabsTrigger>
          <TabsTrigger value="skills">Skills &amp; Documents</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="space-y-4">
          {candidate.professional_summary && (
            <Card title="Professional summary">
              <p className="whitespace-pre-wrap text-body-md text-foreground">{candidate.professional_summary}</p>
            </Card>
          )}
          <Card title="Contact">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <IconLine icon={<Mail className="size-4" />} value={candidate.email} />
              <IconLine icon={<Phone className="size-4" />} value={candidate.phone} />
              <IconLine icon={<MapPin className="size-4" />} value={candidate.location} />
              <IconLine icon={<Link2 className="size-4" />} value={candidate.linkedin_url} href={candidate.linkedin_url} />
              <IconLine icon={<Globe className="size-4" />} value={candidate.portfolio_url} href={candidate.portfolio_url} />
            </div>
          </Card>
          <TagCard title="Sectors" tags={candidate.sectors} />
        </TabsContent>

        {/* Experience */}
        <TabsContent value="experience" className="space-y-4">
          {candidate.work_experience.length === 0 ? (
            <Empty>No work experience recorded.</Empty>
          ) : (
            candidate.work_experience.map((exp, i) => (
              <Card key={i}>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-primary">
                    <Briefcase className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-headline-sm font-semibold text-foreground">{exp.title}</h3>
                      <span className="text-body-sm text-muted-foreground">
                        {exp.start_date ?? "?"}
                        {" – "}
                        {exp.is_current ? "Present" : (exp.end_date ?? "?")}
                      </span>
                    </div>
                    {(exp.company || exp.location || exp.employment_type) && (
                      <p className="text-body-sm text-muted-foreground">
                        {[exp.company, exp.location, exp.employment_type].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    {exp.description && (
                      <p className="mt-1.5 whitespace-pre-wrap text-body-sm text-foreground">{exp.description}</p>
                    )}
                    {exp.achievements && (
                      <div className="mt-1.5">
                        <div className="text-label-sm uppercase tracking-wide text-muted-foreground">
                          Key achievements
                        </div>
                        <p className="whitespace-pre-wrap text-body-sm text-foreground">{exp.achievements}</p>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Education & Certifications */}
        <TabsContent value="education" className="space-y-4">
          {candidate.education.length > 0 && (
            <Card title="Education">
              <div className="space-y-3">
                {candidate.education.map((edu, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-primary">
                      <GraduationCap className="size-4" />
                    </div>
                    <div>
                      <div className="text-body-md font-medium text-foreground">{edu.qualification}</div>
                      <div className="text-body-sm text-muted-foreground">
                        {[edu.institution, edu.year].filter(Boolean).join(" · ") || "-"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
          <TagCard title="Certifications" tags={candidate.certifications} />
          <TagCard title="Qualifications" tags={candidate.qualifications} />
          {candidate.education.length === 0 &&
            candidate.certifications.length === 0 &&
            candidate.qualifications.length === 0 && <Empty>No education or certifications recorded.</Empty>}
        </TabsContent>

        {/* Skills & Documents */}
        <TabsContent value="skills" className="space-y-4">
          <TagCard title="Technical skills" tags={candidate.technical_skills} />
          <TagCard title="Professional skills" tags={candidate.skills} />
          <TagCard title="Languages" tags={candidate.languages} />
          <Card title="Documents">
            {candidate.cv_file_path ? (
              <CvDownloadButton path={candidate.cv_file_path} filename={candidate.cv_original_filename} />
            ) : (
              <p className="text-body-sm text-muted-foreground">No CV on file.</p>
            )}
          </Card>
          {candidate.notes && (
            <Card title="Notes">
              <p className="whitespace-pre-wrap text-body-md text-foreground">{candidate.notes}</p>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <ActivityTimeline entityType="candidate" entityId={id} entries={activity} />
    </div>
  );
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card shadow-card p-5">
      {title && <h2 className="mb-2 text-label-sm uppercase tracking-wide text-muted-foreground">{title}</h2>}
      {children}
    </div>
  );
}

function TagCard({ title, tags }: { title: string; tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <Card title={title}>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <Chip key={t}>{t}</Chip>
        ))}
      </div>
    </Card>
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

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-card p-8 text-center text-body-sm text-muted-foreground">
      {children}
    </div>
  );
}
