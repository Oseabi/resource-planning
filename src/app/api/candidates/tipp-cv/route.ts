import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildTippCv, cvFilename, type CvSource } from "@/lib/cv-export/build-tipp-cv";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Render a candidate as a TiPP Focus CV.
 *
 * Accepts either a saved candidate's id, or the reviewed fields straight from
 * the upload screen. The second case is what makes a one-off conversion
 * possible: someone else's CV can be turned into the house template without
 * adding that person to the pool.
 *
 * Nothing is written to storage. The document is built on each request so it
 * always reflects the current record, and there is no stale copy to go out with
 * a bid by mistake.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let body: { candidateId?: string; fields?: Partial<CvSource> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  let source: CvSource;

  if (body.candidateId) {
    const { data, error } = await supabase
      .from("candidates")
      .select(
        "full_name, current_role, designated_group, languages, availability, professional_summary, skills, technical_skills, certifications, qualifications, work_experience, education",
      )
      .eq("id", body.candidateId)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
    }
    source = data as CvSource;
  } else if (body.fields) {
    // Straight from the review screen, so defaults fill anything left untouched.
    source = {
      full_name: "",
      current_role: null,
      designated_group: null,
      languages: [],
      availability: null,
      professional_summary: null,
      skills: [],
      technical_skills: [],
      certifications: [],
      qualifications: [],
      work_experience: [],
      education: [],
      ...body.fields,
    };
  } else {
    return NextResponse.json(
      { error: "Provide either a candidateId or the reviewed fields." },
      { status: 400 },
    );
  }

  let document: Buffer;
  try {
    document = buildTippCv(source);
  } catch (e) {
    // A template error is a deployment problem, not something the user can fix,
    // so say so plainly rather than showing them a render trace.
    console.error("TiPP CV generation failed", e);
    return NextResponse.json(
      { error: "Could not build the CV. The template may be missing or out of date." },
      { status: 500 },
    );
  }

  return new NextResponse(new Uint8Array(document), {
    headers: {
      "Content-Type": DOCX_MIME,
      "Content-Disposition": `attachment; filename="${cvFilename(source.full_name)}"`,
      "Content-Length": String(document.length),
    },
  });
}
