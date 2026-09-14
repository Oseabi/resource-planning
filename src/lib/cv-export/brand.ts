/**
 * Whose name and colour a generated CV carries.
 *
 * A department's, when the person generating it belongs to one or an admin
 * is looking through one; nothing for the plain TiPP Focus document. Kept
 * apart from build-tipp-cv.ts, which is server-only, so the type can be
 * named by the context loader and the client button alike.
 */
export interface CvBrand {
  /** Printed under "Candidate Resume" on the cover and in the file name. */
  name: string;
  /** #RRGGBB, the colour of the rules. */
  colour: string;
}
