import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, HeadingLevel, AlignmentType, BorderStyle, WidthType,
  ShadingType, PageNumber, PageBreak, TableOfContents
} from "docx";
import { readFileSync, writeFileSync } from "fs";

const data = JSON.parse(readFileSync(
  "C:/Users/Jace/Desktop/College Files/diko/dissertation/rag/services_clean.json",
  "utf-8"
));

// Group by service
const serviceMap = {};
for (const entry of data) {
  if (!serviceMap[entry.service]) serviceMap[entry.service] = [];
  serviceMap[entry.service].push(entry);
}

// Colors
const DARK_BLUE  = "1F3864";
const MED_BLUE   = "2E74B5";
const HDR_BG     = "1F3864";
const ROW_SHADE  = "DCE6F1";
const GRAY_TEXT  = "595959";

// Border helper
const cell_border = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };
const borders = { top: cell_border, bottom: cell_border, left: cell_border, right: cell_border };

function stepText(raw) {
  // Strip "Step N:" or "Step N. " prefix if present
  return raw.replace(/^Step\s+\d+[:.]\s*/i, "").trim();
}

function makeTable(steps) {
  const rows = [];

  // Header row
  rows.push(new TableRow({
    tableHeader: true,
    children: [
      new TableCell({
        borders,
        width: { size: 1000, type: WidthType.DXA },
        shading: { fill: HDR_BG, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "Step No.", bold: true, color: "FFFFFF", size: 20, font: "Calibri" })]
        })]
      }),
      new TableCell({
        borders,
        width: { size: 8360, type: WidthType.DXA },
        shading: { fill: HDR_BG, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({
          children: [new TextRun({ text: "Action", bold: true, color: "FFFFFF", size: 20, font: "Calibri" })]
        })]
      })
    ]
  }));

  // Data rows
  steps.forEach((step, i) => {
    const shade = i % 2 === 0 ? "FFFFFF" : ROW_SHADE;
    rows.push(new TableRow({
      children: [
        new TableCell({
          borders,
          width: { size: 1000, type: WidthType.DXA },
          shading: { fill: shade, type: ShadingType.CLEAR },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: String(i + 1), size: 20, font: "Calibri" })]
          })]
        }),
        new TableCell({
          borders,
          width: { size: 8360, type: WidthType.DXA },
          shading: { fill: shade, type: ShadingType.CLEAR },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({
            children: [new TextRun({ text: stepText(step), size: 20, font: "Calibri" })]
          })]
        })
      ]
    }));
  });

  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [1000, 8360],
    rows
  });
}

// Build sections content
const children = [];

// ── Title Page ────────────────────────────────────────────────────────────────
children.push(
  new Paragraph({ spacing: { before: 2880 } }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "Calamba City Government", bold: true, size: 48, font: "Calibri", color: DARK_BLUE })]
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "Services Directory", bold: true, size: 48, font: "Calibri", color: DARK_BLUE })]
  }),
  new Paragraph({ spacing: { before: 240 } }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "Sub-Services, Departments, and Step-by-Step Procedures", size: 28, font: "Calibri", color: MED_BLUE })]
  }),
  new Paragraph({ spacing: { before: 720 } }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: `${new Date().toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" })}`, size: 24, font: "Calibri", color: GRAY_TEXT })]
  }),
  new Paragraph({ children: [new PageBreak()] })
);

// ── Table of Contents ─────────────────────────────────────────────────────────
children.push(
  new TableOfContents("Table of Contents", {
    hyperlink: true,
    headingStyleRange: "1-2",
    stylesWithLevels: []
  }),
  new Paragraph({ children: [new PageBreak()] })
);

// ── Service sections ──────────────────────────────────────────────────────────
const serviceNames = Object.keys(serviceMap);
serviceNames.forEach((service, si) => {
  // Heading 1 — Service
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: service, bold: true, size: 32, font: "Calibri", color: DARK_BLUE })]
    })
  );

  const subservices = serviceMap[service];
  subservices.forEach((entry, ei) => {
    // Heading 2 — Sub-service
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240 },
        children: [new TextRun({ text: entry.subservice, bold: true, size: 26, font: "Calibri", color: MED_BLUE })]
      }),
      // Department
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({ text: entry.department, bold: true, italics: true, size: 22, font: "Calibri", color: GRAY_TEXT })]
      })
    );

    // Steps table
    if (entry.steps && entry.steps.length > 0) {
      children.push(makeTable(entry.steps));
    } else {
      children.push(new Paragraph({
        children: [new TextRun({ text: "No procedure steps available.", italics: true, size: 20, font: "Calibri", color: GRAY_TEXT })]
      }));
    }

    children.push(new Paragraph({ spacing: { before: 200 } }));
  });

  // Page break between services (not after last)
  if (si < serviceNames.length - 1) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
  }
});

// ── Document ──────────────────────────────────────────────────────────────────
const doc = new Document({
  styles: {
    default: {
      document: { run: { font: "Calibri", size: 22 } }
    },
    paragraphStyles: [
      {
        id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: "Calibri", color: DARK_BLUE },
        paragraph: { spacing: { before: 360, after: 120 }, outlineLevel: 0 }
      },
      {
        id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: "Calibri", color: MED_BLUE },
        paragraph: { spacing: { before: 240, after: 80 }, outlineLevel: 1 }
      }
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
      }
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: MED_BLUE, space: 1 } },
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: "Calamba City Government Services Directory", size: 18, font: "Calibri", color: GRAY_TEXT })]
        })]
      })
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          border: { top: { style: BorderStyle.SINGLE, size: 6, color: MED_BLUE, space: 1 } },
          children: [
            new TextRun({ text: "Calamba City Government Services Directory", size: 18, font: "Calibri", color: GRAY_TEXT }),
            new TextRun({ text: "\t\t\tPage ", size: 18, font: "Calibri", color: GRAY_TEXT }),
            new TextRun({ children: [PageNumber.CURRENT], size: 18, font: "Calibri", color: GRAY_TEXT }),
            new TextRun({ text: " of ", size: 18, font: "Calibri", color: GRAY_TEXT }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, font: "Calibri", color: GRAY_TEXT }),
          ],
          tabStops: [
            { type: "right", position: 9360 }
          ]
        })]
      })
    },
    children
  }]
});

Packer.toBuffer(doc).then(buffer => {
  writeFileSync(
    "C:/Users/Jace/Desktop/College Files/diko/dissertation/rag/calamba_city_services.docx",
    buffer
  );
  console.log("Done: calamba_city_services.docx");
});
