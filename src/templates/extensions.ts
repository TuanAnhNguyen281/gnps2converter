import { Node, mergeAttributes } from "@tiptap/core";
import { TableRow } from "@tiptap/extension-table";
import { FIELD_BY_KEY } from "../../server/shared/report-template";

// Inline chip bound to a report field; stored as {type:"field",attrs:{key,decimals}}.
export const FieldNode = Node.create({
  name: "field",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      key: {
        default: "report.title",
        parseHTML: (el) => el.getAttribute("data-field"),
        renderHTML: (attrs) => ({ "data-field": attrs.key }),
      },
      decimals: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute("data-decimals");
          return v === null ? null : Number(v);
        },
        renderHTML: (attrs) =>
          attrs.decimals === null || attrs.decimals === undefined
            ? {}
            : { "data-decimals": String(attrs.decimals) },
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-field]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const def = FIELD_BY_KEY.get(node.attrs.key);
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: `tpl-field${def?.scope === "row" ? " row" : ""}`,
        title: def ? `${def.group} · ${def.label}` : node.attrs.key,
      }),
      def?.label ?? node.attrs.key,
    ];
  },
  renderText({ node }) {
    return `«${FIELD_BY_KEY.get(node.attrs.key)?.label ?? node.attrs.key}»`;
  },
});

export const PageBreakNode = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: "div[data-page-break]" }];
  },
  renderHTML() {
    return [
      "div",
      { "data-page-break": "", class: "tpl-page-break" },
      "Ngắt trang",
    ];
  },
});

// A table row marked to repeat once per report row on export.
export const RepeatTableRow = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      repeat: {
        default: null,
        parseHTML: (el) => {
          try {
            return JSON.parse(el.getAttribute("data-repeat") ?? "null");
          } catch {
            return null;
          }
        },
        renderHTML: (attrs) =>
          attrs.repeat
            ? {
                "data-repeat": JSON.stringify(attrs.repeat),
                class: "tpl-repeat",
              }
            : {},
      },
    };
  },
});
