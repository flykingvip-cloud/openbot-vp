export function scrollEnterpriseOrgTreeToFocus(params: {
  seatId?: string | null;
  teamLabel?: string | null;
  memberUser?: string | null;
}) {
  if (typeof document === "undefined") {
    return;
  }
  const rail = document.querySelector(".enterprise-org-layout__rail .enterprise-org-tree");
  if (!rail) {
    return;
  }
  const selector = params.seatId
    ? `[data-org-seat-id="${params.seatId}"]`
    : params.memberUser
      ? `[data-org-member-user="${params.memberUser}"]`
      : params.teamLabel
        ? `[data-org-team-path="${CSS.escape(params.teamLabel)}"]`
        : null;
  if (!selector) {
    return;
  }
  const node = rail.querySelector(selector);
  if (!(node instanceof HTMLElement)) {
    return;
  }
  let parent = node.closest("details");
  while (parent instanceof HTMLDetailsElement) {
    parent.open = true;
    parent = parent.parentElement?.closest("details") ?? null;
  }
  node.classList.remove("is-focus-pulse");
  void node.offsetWidth;
  node.classList.add("is-focus-pulse");
  node.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
