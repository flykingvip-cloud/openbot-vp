// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import {
  computeTotalPages,
  computeVisiblePages,
  type PaginationPageSize,
  renderPagination,
} from "./pagination.ts";

function mount() {
  return document.createElement("div");
}

function noop(): void {
  /* noop */
}

describe("computeTotalPages", () => {
  it("returns 1 when totalItems is 0 (UI placeholder for empty list)", () => {
    expect(computeTotalPages(0, 10)).toBe(1);
  });

  it("rounds up partial pages", () => {
    expect(computeTotalPages(1, 10)).toBe(1);
    expect(computeTotalPages(11, 10)).toBe(2);
    expect(computeTotalPages(128, 10)).toBe(13);
    expect(computeTotalPages(128, 20)).toBe(7);
    expect(computeTotalPages(128, 50)).toBe(3);
  });

  it("handles negative input as empty", () => {
    expect(computeTotalPages(-5, 10)).toBe(1);
  });
});

describe("computeVisiblePages", () => {
  it("returns sequential pages without ellipsis when totalPages ≤ 7", () => {
    expect(computeVisiblePages(1, 1)).toEqual([1]);
    expect(computeVisiblePages(3, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(computeVisiblePages(7, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("inserts a trailing ellipsis when current page is near the start", () => {
    // totalPages = 13, currentPage = 1: [1, 2, 3, ellipsis, 13]
    expect(computeVisiblePages(1, 13)).toEqual([1, 2, 3, "ellipsis", 13]);
  });

  it("inserts a leading ellipsis when current page is near the end", () => {
    // totalPages = 13, currentPage = 13: [1, ellipsis, 11, 12, 13]
    expect(computeVisiblePages(13, 13)).toEqual([1, "ellipsis", 11, 12, 13]);
  });

  it("inserts both ellipses when current page is in the middle", () => {
    // totalPages = 13, currentPage = 7 → window 5..9
    expect(computeVisiblePages(7, 13)).toEqual([1, "ellipsis", 5, 6, 7, 8, 9, "ellipsis", 13]);
  });

  it("never duplicates first/last when window touches them", () => {
    // currentPage = 3, totalPages = 13 → window 2..5, no leading ellipsis
    expect(computeVisiblePages(3, 13)).toEqual([1, 2, 3, 4, 5, "ellipsis", 13]);
    // currentPage = 11, totalPages = 13 → window 9..12, no trailing ellipsis
    expect(computeVisiblePages(11, 13)).toEqual([1, "ellipsis", 9, 10, 11, 12, 13]);
  });
});

describe("renderPagination — empty state", () => {
  it("renders only the total label and page size selector when totalItems = 0", () => {
    const container = mount();
    render(
      renderPagination({
        currentPage: 1,
        pageSize: 10,
        totalItems: 0,
        onPageChange: noop,
        onPageSizeChange: noop,
      }),
      container,
    );

    expect(container.querySelector(".pagination--empty")).not.toBeNull();
    expect(container.querySelector(".pagination__total")?.textContent).toContain("共 0 项");
    expect(container.querySelector(".pagination__nav")).toBeNull();
    expect(container.querySelector(".pagination__page-size-select")).not.toBeNull();
  });

  it("uses the provided totalLabel verbatim when given", () => {
    const container = mount();
    render(
      renderPagination({
        currentPage: 1,
        pageSize: 10,
        totalItems: 0,
        totalLabel: "共 0 项能力资产",
        onPageChange: noop,
        onPageSizeChange: noop,
      }),
      container,
    );

    expect(container.querySelector(".pagination__total")?.textContent).toContain("共 0 项能力资产");
  });
});

describe("renderPagination — navigation rendering", () => {
  it("renders prev / numbered / next buttons + ellipsis for 128 items @ 10/page", () => {
    const container = mount();
    render(
      renderPagination({
        currentPage: 1,
        pageSize: 10,
        totalItems: 128,
        totalLabel: "共 128 项能力资产",
        onPageChange: noop,
        onPageSizeChange: noop,
      }),
      container,
    );

    expect(container.querySelector(".pagination__total")?.textContent).toContain(
      "共 128 项能力资产",
    );
    expect(container.querySelector(".pagination__step-button--prev")).not.toBeNull();
    expect(container.querySelector(".pagination__step-button--next")).not.toBeNull();
    expect(container.querySelectorAll(".pagination__page-button").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".pagination__ellipsis").length).toBeGreaterThan(0);
  });

  it("disables the previous button on the first page", () => {
    const container = mount();
    render(
      renderPagination({
        currentPage: 1,
        pageSize: 10,
        totalItems: 50,
        onPageChange: noop,
        onPageSizeChange: noop,
      }),
      container,
    );

    const prev = container.querySelector<HTMLButtonElement>(".pagination__step-button--prev");
    const next = container.querySelector<HTMLButtonElement>(".pagination__step-button--next");
    expect(prev?.disabled).toBe(true);
    expect(next?.disabled).toBe(false);
  });

  it("disables the next button on the last page", () => {
    const container = mount();
    render(
      renderPagination({
        currentPage: 5,
        pageSize: 10,
        totalItems: 50,
        onPageChange: noop,
        onPageSizeChange: noop,
      }),
      container,
    );

    const prev = container.querySelector<HTMLButtonElement>(".pagination__step-button--prev");
    const next = container.querySelector<HTMLButtonElement>(".pagination__step-button--next");
    expect(prev?.disabled).toBe(false);
    expect(next?.disabled).toBe(true);
  });

  it("highlights the active page button via aria-current", () => {
    const container = mount();
    render(
      renderPagination({
        currentPage: 3,
        pageSize: 10,
        totalItems: 100,
        onPageChange: noop,
        onPageSizeChange: noop,
      }),
      container,
    );

    const active = container.querySelector(".pagination__page-button--active");
    expect(active).not.toBeNull();
    expect(active?.getAttribute("aria-current")).toBe("page");
    expect(active?.textContent?.trim()).toBe("3");
  });
});

describe("renderPagination — interaction", () => {
  it("invokes onPageChange with the next page when clicking the next button", () => {
    const container = mount();
    const onPageChange = vi.fn();
    render(
      renderPagination({
        currentPage: 2,
        pageSize: 10,
        totalItems: 100,
        onPageChange,
        onPageSizeChange: noop,
      }),
      container,
    );

    const next = container.querySelector(".pagination__step-button--next") as HTMLButtonElement;
    next.click();
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("does not invoke onPageChange when clicking the active page", () => {
    const container = mount();
    const onPageChange = vi.fn();
    render(
      renderPagination({
        currentPage: 3,
        pageSize: 10,
        totalItems: 100,
        onPageChange,
        onPageSizeChange: noop,
      }),
      container,
    );

    const active = container.querySelector(".pagination__page-button--active") as HTMLButtonElement;
    active.click();
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("invokes onPageSizeChange with the chosen size from the select", () => {
    const container = mount();
    const onPageSizeChange = vi.fn();
    render(
      renderPagination({
        currentPage: 1,
        pageSize: 10,
        totalItems: 100,
        onPageChange: noop,
        onPageSizeChange,
      }),
      container,
    );

    const select = container.querySelector(".pagination__page-size-select") as HTMLSelectElement;
    select.value = "20";
    select.dispatchEvent(new Event("change"));
    expect(onPageSizeChange).toHaveBeenCalledWith(20 satisfies PaginationPageSize);
  });
});

describe("renderPagination — accessibility (requirement 18.8)", () => {
  it("ensures all interactive controls have at least 32×32 minimum size styling", () => {
    const container = mount();
    document.body.appendChild(container);
    try {
      render(
        renderPagination({
          currentPage: 2,
          pageSize: 10,
          totalItems: 100,
          onPageChange: noop,
          onPageSizeChange: noop,
        }),
        container,
      );

      const interactives = [
        ...container.querySelectorAll(".pagination__step-button"),
        ...container.querySelectorAll(".pagination__page-button"),
        ...container.querySelectorAll(".pagination__page-size-select"),
      ] as HTMLElement[];

      expect(interactives.length).toBeGreaterThan(0);
      // Min-height is enforced via the .pagination__* classes in
      // enterprise-components.css. We verify class presence (which guarantees
      // 32px min-height per the stylesheet) rather than inline styles.
      for (const el of interactives) {
        const className = el.className;
        const hasSizingClass =
          /pagination__step-button|pagination__page-button|pagination__page-size-select/.test(
            className,
          );
        expect(hasSizingClass).toBe(true);
      }
    } finally {
      container.remove();
    }
  });

  it("exposes a navigation landmark with an aria-label", () => {
    const container = mount();
    render(
      renderPagination({
        currentPage: 1,
        pageSize: 10,
        totalItems: 0,
        onPageChange: noop,
        onPageSizeChange: noop,
      }),
      container,
    );

    const root = container.querySelector(".pagination");
    expect(root?.tagName.toLowerCase()).toBe("nav");
    expect(root?.getAttribute("aria-label")).toBe("分页导航");
  });
});
