"""PDF generation for DDT documents using reportlab."""
from io import BytesIO
from typing import Dict, Any, List
from datetime import datetime

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    KeepTogether,
)


def _qty_fmt(q: Any) -> str:
    try:
        f = float(q)
        return str(int(f)) if f.is_integer() else str(f)
    except Exception:
        return str(q)


def generate_ddt_pdf(record: Dict[str, Any]) -> BytesIO:
    """Build a professional DDT PDF from a stored checklist record."""
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=15 * mm,
        bottomMargin=15 * mm,
        title=f"DDT {record.get('ddt_number') or record.get('id', '')}",
    )
    styles = getSampleStyleSheet()

    NAVY = colors.HexColor("#0f172a")
    SLATE = colors.HexColor("#475569")
    LIGHT = colors.HexColor("#f1f5f9")
    BORDER = colors.HexColor("#e2e8f0")
    AMBER = colors.HexColor("#f59e0b")

    h1 = ParagraphStyle(
        "h1", parent=styles["Heading1"],
        fontSize=20, textColor=NAVY, spaceAfter=2, leading=24,
    )
    small = ParagraphStyle(
        "small", parent=styles["Normal"],
        fontSize=8, textColor=SLATE, leading=10, alignment=TA_LEFT,
    )
    label = ParagraphStyle(
        "label", parent=styles["Normal"],
        fontSize=7.5, textColor=SLATE, leading=10, alignment=TA_LEFT,
        spaceAfter=0, fontName="Helvetica-Bold",
    )
    value = ParagraphStyle(
        "value", parent=styles["Normal"],
        fontSize=11, textColor=NAVY, leading=14, alignment=TA_LEFT,
        fontName="Helvetica-Bold",
    )
    note_style = ParagraphStyle(
        "note", parent=styles["Normal"],
        fontSize=9, textColor=NAVY, leading=12, backColor=colors.HexColor("#fef3c7"),
        borderPadding=6, alignment=TA_LEFT,
    )

    story: List[Any] = []

    # ---- Header ----
    header_left = Paragraph(
        '<font size="8" color="#64748b">ELIOS TECH — MAGAZZINO</font><br/>'
        '<font size="20" color="#0f172a"><b>Documento di Trasporto</b></font>',
        h1,
    )
    ddt_number = (record.get("ddt_number") or "").strip() or "—"
    header_right = Paragraph(
        f'<para align="right"><font size="8" color="#64748b">NUMERO DDT</font><br/>'
        f'<font size="18" color="#0f172a"><b>{ddt_number}</b></font></para>',
        small,
    )
    ht = Table([[header_left, header_right]], colWidths=[110 * mm, 65 * mm])
    ht.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(ht)
    story.append(Spacer(1, 4 * mm))

    # divider
    div = Table([[""]], colWidths=[175 * mm], rowHeights=[1])
    div.setStyle(TableStyle([("LINEABOVE", (0, 0), (-1, 0), 1, NAVY)]))
    story.append(div)
    story.append(Spacer(1, 6 * mm))

    # ---- Info block ----
    def _cell(lbl: str, val: str) -> Any:
        return [
            Paragraph(lbl.upper(), label),
            Paragraph((val or "—").replace("\n", "<br/>"), value),
        ]

    op = record.get("operator", "")
    cli = record.get("structure", "")
    date = record.get("shipping_date", "")
    created = record.get("created_at", "")
    try:
        created_disp = datetime.fromisoformat(created.replace("Z", "+00:00")).strftime("%d/%m/%Y %H:%M")
    except Exception:
        created_disp = created or "—"

    info = Table(
        [
            [_cell("Cliente / Destinazione", cli), _cell("Data Spedizione", date)],
            [_cell("Operatore", op), _cell("Data Emissione", created_disp)],
        ],
        colWidths=[87.5 * mm, 87.5 * mm],
    )
    info.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(info)
    story.append(Spacer(1, 8 * mm))

    # ---- Materials table ----
    story.append(Paragraph(
        '<font size="9" color="#64748b"><b>MATERIALI SPEDITI</b></font>', small
    ))
    story.append(Spacer(1, 2 * mm))

    items = record.get("items", []) or []
    rows: List[List[Any]] = [["#", "Materiale", "Codice", "Q.tà", "Unità", "Seriali S/N"]]
    idx = 1
    cell_style = ParagraphStyle(
        "cell", parent=styles["Normal"], fontSize=9, leading=11, textColor=NAVY
    )
    cell_sn = ParagraphStyle(
        "cellsn", parent=styles["Normal"], fontSize=8, leading=10,
        textColor=colors.HexColor("#334155"), fontName="Courier",
    )
    for it in items:
        name = it.get("name", "")
        code = it.get("code") or ""
        qty = _qty_fmt(it.get("quantity"))
        unit = it.get("unit") or "pz"
        serials = it.get("serials") or []
        sn_para = Paragraph("<br/>".join(serials), cell_sn) if serials else Paragraph("—", cell_style)
        rows.append([
            str(idx),
            Paragraph(name, cell_style),
            Paragraph(code, cell_style),
            qty,
            unit,
            sn_para,
        ])
        idx += 1

    mat = Table(
        rows,
        colWidths=[10 * mm, 60 * mm, 25 * mm, 15 * mm, 15 * mm, 50 * mm],
        repeatRows=1,
    )
    mat.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 8),
        ("ALIGN", (0, 0), (-1, 0), "LEFT"),
        ("ALIGN", (3, 1), (4, -1), "CENTER"),
        ("ALIGN", (0, 1), (0, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, BORDER),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(mat)
    story.append(Spacer(1, 4 * mm))

    # Totals
    total_units = sum((float(i.get("quantity") or 0) for i in items))
    story.append(Paragraph(
        f'<para align="right"><font size="9" color="#475569">Totale colli: </font>'
        f'<font size="11" color="#0f172a"><b>{_qty_fmt(total_units)}</b></font></para>',
        small,
    ))

    # Notes
    notes = (record.get("notes") or "").strip()
    if notes:
        story.append(Spacer(1, 6 * mm))
        story.append(Paragraph(
            '<font size="9" color="#64748b"><b>NOTE</b></font>', small
        ))
        story.append(Spacer(1, 2 * mm))
        story.append(Paragraph(notes, note_style))

    story.append(Spacer(1, 12 * mm))

    # ---- Signatures block ----
    sig_lbl = ParagraphStyle(
        "siglbl", parent=styles["Normal"], fontSize=8, textColor=SLATE,
        alignment=TA_LEFT, leading=10, fontName="Helvetica-Bold",
    )
    sig_note = ParagraphStyle(
        "signote", parent=styles["Normal"], fontSize=7.5, textColor=SLATE, leading=10,
    )
    sign_left = [
        Paragraph("FIRMA OPERATORE / MITTENTE", sig_lbl),
        Spacer(1, 15 * mm),
        Paragraph("Data ______________________________", sig_note),
    ]
    sign_right = [
        Paragraph("FIRMA CLIENTE PER RICEVUTA", sig_lbl),
        Spacer(1, 15 * mm),
        Paragraph("Data ______________________________", sig_note),
    ]
    sig_table = Table([[sign_left, sign_right]], colWidths=[87.5 * mm, 87.5 * mm])
    sig_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (0, 0), 0.5, SLATE),
        ("LINEBELOW", (1, 0), (1, 0), 0.5, SLATE),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(KeepTogether(sig_table))

    story.append(Spacer(1, 8 * mm))
    story.append(Paragraph(
        '<font size="7" color="#94a3b8">Documento generato automaticamente '
        f'da Checklist Elios Tech — {datetime.now().strftime("%d/%m/%Y %H:%M")}</font>',
        small,
    ))

    doc.build(story)
    buf.seek(0)
    return buf
