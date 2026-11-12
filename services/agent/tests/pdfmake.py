"""試験用の小さな PDF（ASCII の文字だけ・ページごとに1行）を作る。"""


def make_pdf(pages: list[str]) -> bytes:
    objs: list[bytes] = []
    n = len(pages)
    kids = " ".join(f"{3 + i * 2} 0 R" for i in range(n))
    objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objs.append(f"<< /Type /Pages /Kids [{kids}] /Count {n} >>".encode())
    font = 3 + n * 2
    for i, t in enumerate(pages):
        objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents {4 + i * 2} 0 R "
                    f"/Resources << /Font << /F1 {font} 0 R >> >> >>".encode())
        body = f"BT /F1 12 Tf 72 760 Td ({t}) Tj ET".encode()
        objs.append(b"<< /Length %d >>\nstream\n" % len(body) + body + b"\nendstream")
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    out = b"%PDF-1.4\n"
    offs = []
    for i, o in enumerate(objs, 1):
        offs.append(len(out))
        out += f"{i} 0 obj\n".encode() + o + b"\nendobj\n"
    x = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offs)
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{x}\n%%EOF\n".encode()
    return out
