/**
 * The app's one spacing scale for page sections. Previously each section
 * on each page improvised its own vertical margin (and `BracketHeader`
 * tried to own the "gap above me" concern via `mt-12 first:mt-0`, which
 * silently zeroed itself out any time the label was the first child of
 * its own wrapper — the common case — leaving section after section
 * jammed against whatever came before it: WATCHING against the
 * disclosure paragraph, HOW IT WORKS against the chain badge, WHAT IT
 * DOES NOT DO against the pipeline cards). One value, defined once,
 * applied explicitly by `<Section>` and `BracketHeader` — no
 * first-child trick to accidentally cancel out.
 */

/** Vertical gap between one section and the section before it. */
export const SECTION_GAP = "mt-16 sm:mt-20";

/** Gap between a BracketHeader label and the content directly below it. */
export const LABEL_GAP = "mb-4";
