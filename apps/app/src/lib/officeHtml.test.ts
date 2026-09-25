import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "./pasteMarkdown";

/// Word, and the other word processors, on the clipboard.
///
/// Word's HTML is a document written for Word to read back: its structure lives in class names and
/// `mso-` styles rather than in HTML elements. A list is a run of paragraphs whose bullet is a
/// literal character in a span Word marks to be ignored; a title is a paragraph with a class; a
/// table has no header row. Read as ordinary HTML, all of that arrives as text with stray bullets in
/// it. These tests pin what a paste should make of it - the structure markdown can express - and that
/// everything else (fonts, colours, underline, spacing, Word's own bookkeeping) is dropped.
///
/// The fixtures are written in the shape each program puts on the clipboard, with invented content.

/// Word for Windows and macOS wrap a copied fragment in a full document: namespaces, a generator
/// tag, a style block and conditional comments, none of which is content.
function word(fragment: string): string {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta name=Generator content="Microsoft Word 15">
<style><!-- p.MsoNormal {margin:0cm; font-family:"Calibri",sans-serif;} --></style>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Normal</w:View></w:WordDocument></xml><![endif]-->
</head><body lang=EN-GB style='tab-interval:36.0pt'><!--StartFragment-->${fragment}<!--EndFragment--></body></html>`;
}

/// One Word list paragraph: the marker Word draws is a literal character inside a span styled
/// `mso-list:Ignore`, and the level is in the paragraph's own `mso-list` style.
function wordItem(level: number, marker: string, text: string, font = "Symbol"): string {
  return `<p class=MsoListParagraphCxSpMiddle style='margin-left:${36 * level}.0pt;text-indent:-18.0pt;mso-list:l0 level${level} lfo1'><![if !supportLists]><span style='font-family:${font};mso-fareast-font-family:${font}'><span style='mso-list:Ignore'>${marker}<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>${text}<o:p></o:p></p>`;
}

describe("Word for Windows and macOS", () => {
  it("keeps headings and emphasis, and drops what markdown cannot say", () => {
    const html = word(`
<p class=MsoTitle>Project plan<o:p></o:p></p>
<h1><a name="_Toc100"></a>Goals<o:p></o:p></h1>
<p class=MsoNormal>Some <b>bold</b>, <i>italic</i>, <s>struck</s> and <u>underlined</u> <span style='color:#C00000;font-size:14.0pt'>coloured</span> text.<o:p></o:p></p>
<p class=MsoNormal><o:p>&nbsp;</o:p></p>
<h2>Scope<o:p></o:p></h2>
<p class=MsoNormal>Second&nbsp;paragraph.<o:p></o:p></p>`);

    expect(htmlToMarkdown(html)).toBe(
      "# Project plan\n\n# Goals\n\nSome **bold**, *italic*, ~~struck~~ and underlined coloured text.\n\n## Scope\n\nSecond paragraph.",
    );
  });

  it("turns bulleted paragraphs into a list, nested by Word's level", () => {
    const html = word(
      wordItem(1, "·", "First item") +
        wordItem(2, "o", "Nested item", '"Courier New"') +
        wordItem(3, "§", "Deeper item", "Wingdings") +
        wordItem(1, "·", "Second item") +
        `<p class=MsoNormal>After the list.<o:p></o:p></p>`,
    );

    expect(htmlToMarkdown(html)).toBe(
      "- First item\n  - Nested item\n    - Deeper item\n- Second item\n\nAfter the list.",
    );
  });

  it("turns numbered paragraphs into a numbered list, keeping where it starts", () => {
    const html = word(
      wordItem(1, "3.", "Third step", "Calibri") +
        wordItem(2, "a.", "A detail", "Calibri") +
        wordItem(2, "b.", "Another detail", "Calibri") +
        wordItem(1, "4.", "Fourth step", "Calibri"),
    );

    expect(htmlToMarkdown(html)).toBe("3. Third step\n   1. A detail\n   2. Another detail\n4. Fourth step");
  });

  it("gives a table its first row as the header, and one line per cell", () => {
    const html = word(`
<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0 style='border-collapse:collapse;mso-yfti-tbllook:1184'>
 <tr style='mso-yfti-irow:0'>
  <td width=301 valign=top style='width:225.4pt;border:solid windowtext 1.0pt'><p class=MsoNormal><b>Name<o:p></o:p></b></p></td>
  <td width=301 valign=top style='width:225.4pt;border:solid windowtext 1.0pt'><p class=MsoNormal><b>Role<o:p></o:p></b></p></td>
 </tr>
 <tr style='mso-yfti-irow:1'>
  <td width=301 valign=top><p class=MsoNormal>Ada<o:p></o:p></p></td>
  <td width=301 valign=top><p class=MsoNormal>Writes the plan.<o:p></o:p></p><p class=MsoNormal>Reviews it too.<o:p></o:p></p></td>
 </tr>
</table>`);

    expect(htmlToMarkdown(html)).toBe(
      "| **Name** | **Role** |\n| --- | --- |\n| Ada | Writes the plan. Reviews it too. |",
    );
  });

  it("writes monospaced paragraphs as a code block, and a monospaced run as inline code", () => {
    const html = word(`
<p class=MsoNormal>Run <span style='font-family:Consolas'>npm test</span> first.<o:p></o:p></p>
<p class=MsoNormal><span style='font-family:"Courier New"'>const a = 1;<o:p></o:p></span></p>
<p class=MsoNormal><span style='font-family:"Courier New"'>&nbsp;&nbsp;return a;<o:p></o:p></span></p>
<p class=MsoNormal>Then ship.<o:p></o:p></p>`);

    expect(htmlToMarkdown(html)).toBe(
      "Run `npm test` first.\n\n```\nconst a = 1;\n  return a;\n```\n\nThen ship.",
    );
  });

  it("makes a quote style a quotation", () => {
    const html = word(`<p class=MsoQuote>Measure twice.<o:p></o:p></p>`);

    expect(htmlToMarkdown(html)).toBe("> Measure twice.");
  });

  // A copied picture points at a temporary file on the machine that copied it - a path that means
  // nothing in the document and names the user's own folders.
  it("drops pictures that only exist on the copying machine, and keeps web ones", () => {
    const html = word(`
<p class=MsoNormal><img width=100 height=50 src="file:///C:/Users/Ada/AppData/Local/Temp/msohtmlclip1/01/clip_image001.png" alt="Chart"><o:p></o:p></p>
<p class=MsoNormal><v:shape id="Picture_1" style='width:75pt'><v:imagedata src="file:///C:/Temp/clip_image002.png" o:title=""/></v:shape>Caption<o:p></o:p></p>
<p class=MsoNormal><img src="https://example.com/logo.png" alt="Logo"><o:p></o:p></p>`);

    expect(htmlToMarkdown(html)).toBe("Caption\n\n![Logo](https://example.com/logo.png)");
  });

  it("keeps real links, and unwraps bookmarks and links within the document", () => {
    const html = word(`
<p class=MsoNormal>See <a href="https://example.com/spec">the spec</a> and <a href="#_Toc100">Goals</a><a name="_Hlk1"></a>.<o:p></o:p></p>`);

    expect(htmlToMarkdown(html)).toBe("See [the spec](https://example.com/spec) and Goals.");
  });
});

describe("Word for the web", () => {
  it("reads headings from their role, and nests the one-item lists it writes", () => {
    const html = `<div class="OutlineElement Ltr"><p class="Paragraph" role="heading" aria-level="2"><span class="TextRun"><span class="NormalTextRun">Next steps</span></span><span class="EOP">&nbsp;</span></p></div>
<div class="ListContainerWrapper"><ul class="BulletListStyle1"><li data-listid="1" data-aria-level="1" role="listitem" class="OutlineElement"><p class="Paragraph"><span class="TextRun" style="font-weight:bold"><span class="NormalTextRun">Draft</span></span><span class="TextRun"><span class="NormalTextRun"> the outline</span></span></p></li></ul></div>
<div class="ListContainerWrapper"><ul class="BulletListStyle2"><li data-listid="1" data-aria-level="2" role="listitem" class="OutlineElement"><p class="Paragraph"><span class="TextRun" style="font-style:italic">Ask Grace</span></p></li></ul></div>
<div class="ListContainerWrapper"><ul class="BulletListStyle1"><li data-listid="1" data-aria-level="1" role="listitem" class="OutlineElement"><p class="Paragraph"><span class="TextRun">Publish</span></p></li></ul></div>`;

    expect(htmlToMarkdown(html)).toBe("## Next steps\n\n- **Draft** the outline\n  - *Ask Grace*\n- Publish");
  });
});

describe("Google Docs", () => {
  // Docs wraps the whole selection in a <b> whose style turns bold off again. Read literally, every
  // word pasted would be bold.
  it("does not embolden everything, and reads emphasis from span styles", () => {
    const html = `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-0a1b2c3d"><p dir="ltr"><span style="font-weight:700;">Heavy</span><span style="font-weight:400;"> and </span><span style="font-style:italic;font-weight:400;">slanted</span><span style="text-decoration:line-through;"> gone</span></p></b>`;

    expect(htmlToMarkdown(html)).toBe("**Heavy** and *slanted* ~~gone~~");
  });
});
