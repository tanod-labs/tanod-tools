"""Build the binary and derived e-invoice test fixtures in this folder from the hand-written XML files.

The hand-written XML invoices (ubl-*.xml, cii-xrechnung.xml, fatturapa-*.xml, ksef-*.xml, facturx-en16931.xml,
zugferd-basicwl.xml, bad/*.xml) are the source. This script derives:

  facturx-en16931.pdf        a one-page PDF with facturx-en16931.xml embedded as factur-x.xml (Factur-X, EN 16931)
  zugferd-xrechnung.pdf      the same kind of PDF with cii-xrechnung.xml embedded as xrechnung.xml
  zugferd-basicwl.pdf        zugferd-basicwl.xml embedded as zugferd-invoice.xml (a profile with no line items)
  plain.pdf                  a PDF with no embedded files
  other-attachment.pdf       a PDF whose only embedded file is a text note, not an invoice
  fatturapa-fpr12.xml.p7m    CMS SignedData (DER) around fatturapa-fpr12.xml, as Italian signed invoices are
  fatturapa-fpa12-batch.xml.p7m   the same around the two-invoice file, re-encoded as BER (indefinite lengths, the
                             invoice cut into a constructed OCTET STRING of 1000-byte pieces), as some providers write them
  fatturapa-fpr12-base64.p7m the DER file as base64 text with PEM-style lines
  fatturapa-double.p7m       the DER file signed once more (a counter-signature wrapper), the invoice two levels down
  detached.p7m               a detached CMS signature: it carries no invoice at all
  fatturapa-latin1.xml       the FPR12 invoice declared and encoded as ISO-8859-1
  peppol-sbdh.xml            the Peppol invoice inside a Standard Business Document Header envelope

These are test stand-ins: the PDFs are Factur-X shaped (XMP metadata, /AF array, embedded file in the name tree) but are
not PDF/A-3 conformant (fonts are not embedded), and the p7m files use a throwaway self-signed key made on the spot.
Nothing in the viewer verifies PDF/A or signatures. The outputs are committed so the checks do not need Python.

Usage (needs pikepdf and cryptography):
  python3 ops/tools_site/check/einvoice-fixtures/build_fixtures.py   (a Python with pikepdf and cryptography installed)
"""
import base64
import datetime
import re
import sys
from pathlib import Path

import pikepdf
from pikepdf import Array, AttachedFileSpec, Dictionary, Name, Pdf, String
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs7
from cryptography.x509.oid import NameOID

HERE = Path(__file__).resolve().parent


# ------------------------------------------------------------------ PDFs

XMP = """<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
   <pdfaid:part>3</pdfaid:part>
   <pdfaid:conformance>B</pdfaid:conformance>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">{title}</rdf:li></rdf:Alt></dc:title>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
   <fx:DocumentType>INVOICE</fx:DocumentType>
   <fx:DocumentFileName>{filename}</fx:DocumentFileName>
   <fx:Version>1.0</fx:Version>
   <fx:ConformanceLevel>{level}</fx:ConformanceLevel>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>"""


def pdf_text(s: str) -> str:
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def make_pdf(lines):
    pdf = Pdf.new()
    font = pdf.make_indirect(Dictionary(Type=Name.Font, Subtype=Name.Type1, BaseFont=Name.Helvetica, Encoding=Name.WinAnsiEncoding))
    page = pdf.add_blank_page(page_size=(595, 842))
    page.Resources = Dictionary(Font=Dictionary(F1=font))
    body = "BT /F1 14 Tf 56 780 Td 18 TL " + "".join(f"({pdf_text(l)}) Tj T* " for l in lines) + "ET"
    page.Contents = pdf.make_stream(body.encode("cp1252", "replace"))
    return pdf


def embed(pdf, xml_bytes, filename, description, xmp_level=None, relationship=Name.Data):
    spec = AttachedFileSpec(pdf, xml_bytes, mime_type="text/xml", description=description, filename=filename,
                            relationship=relationship)
    pdf.attachments[filename] = spec
    pdf.Root.AF = pdf.make_indirect(Array([spec.obj]))
    if xmp_level:
        xmp = XMP.format(title=pdf_text(description), filename=filename, level=xmp_level).encode("utf-8")
        pdf.Root.Metadata = pdf.make_stream(xmp, Type=Name.Metadata, Subtype=Name.XML)


def build_pdfs():
    jobs = [
        ("facturx-en16931.pdf", "facturx-en16931.xml", "factur-x.xml", "Factur-X invoice", "EN 16931",
         ["Exemple Services SAS", "Facture FA-2024-05-0189 du 21/05/2024", "Montant a payer : 3 647,16 EUR", "(Factur-X, profil EN 16931)"]),
        ("zugferd-xrechnung.pdf", "cii-xrechnung.xml", "xrechnung.xml", "XRechnung invoice", "XRECHNUNG",
         ["Muster Maschinenbau GmbH & Co. KG", "Rechnung R-2024-1187 vom 18.03.2024", "Zahlbetrag: 1.697,00 EUR", "(ZUGFeRD, Profil XRECHNUNG)"]),
        ("zugferd-basicwl.pdf", "zugferd-basicwl.xml", "zugferd-invoice.xml", "ZUGFeRD invoice", "BASIC WL",
         ["Kleinbetrieb Beispiel e.K.", "Rechnung ZF-2024-001 vom 02.01.2024", "Zahlbetrag: 119,00 EUR", "(ZUGFeRD, Profil BASIC WL)"]),
    ]
    for out, src, name, desc, level, lines in jobs:
        pdf = make_pdf(lines)
        embed(pdf, (HERE / src).read_bytes(), name, desc, level)
        pdf.save(HERE / out, deterministic_id=True)
        print("wrote", out)
    pdf = make_pdf(["Plain PDF invoice", "No data is embedded in this file."])
    pdf.save(HERE / "plain.pdf", deterministic_id=True)
    pdf = make_pdf(["PDF with an attachment that is not an invoice"])
    spec = AttachedFileSpec(pdf, b"Remember to send the goods.\n", mime_type="text/plain", description="Note", filename="notes.txt")
    pdf.attachments["notes.txt"] = spec
    pdf.save(HERE / "other-attachment.pdf", deterministic_id=True)
    print("wrote plain.pdf, other-attachment.pdf")


# ------------------------------------------------------------------ CMS (.p7m)

def self_signed():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Throwaway test signer (not a real certificate)")])
    now = datetime.datetime(2024, 1, 1)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now)
            .not_valid_after(now + datetime.timedelta(days=3650)).sign(key, hashes.SHA256()))
    return key, cert


def sign(data: bytes, key, cert, detached=False) -> bytes:
    opts = [pkcs7.PKCS7Options.Binary] + ([pkcs7.PKCS7Options.DetachedSignature] if detached else [])
    return pkcs7.PKCS7SignatureBuilder().set_data(data).add_signer(cert, key, hashes.SHA256()).sign(serialization.Encoding.DER, opts)


def read_tlv(b: bytes, pos: int):
    """(tag byte, constructed, value start, value end, next position) of a definite-length DER item."""
    tag = b[pos]
    assert tag & 0x1F != 0x1F, "high tag numbers are not used here"
    pos += 1
    ln = b[pos]
    pos += 1
    if ln & 0x80:
        n = ln & 0x7F
        ln = int.from_bytes(b[pos:pos + n], "big")
        pos += n
    return tag, bool(tag & 0x20), pos, pos + ln, pos + ln


def indef(tag: int, inner: bytes) -> bytes:
    return bytes([tag, 0x80]) + inner + b"\x00\x00"


def cms_to_ber(der: bytes) -> bytes:
    """Re-encode the outer levels of a DER SignedData the way OpenSSL's streaming mode and some Italian providers do:
    ContentInfo, [0], SignedData and encapContentInfo get indefinite lengths and the signed content becomes a constructed
    OCTET STRING of 1000-byte pieces. Certificates and signerInfos stay as they were, so the signature still verifies."""
    _, _, vs, ve, _ = read_tlv(der, 0)                              # ContentInfo SEQUENCE
    oid_end = read_tlv(der, vs)[4]
    oid = der[vs:oid_end]
    _, _, wrap_s, wrap_e, _ = read_tlv(der, oid_end)                # [0] EXPLICIT
    _, _, sd_s, sd_e, _ = read_tlv(der, wrap_s)                     # SignedData SEQUENCE
    kids, pos = [], sd_s
    while pos < sd_e:
        _, _, a, b, nxt = read_tlv(der, pos)
        kids.append((pos, a, b, nxt))
        pos = nxt
    version, digests, encap = (der[k[0]:k[3]] for k in kids[:3])
    rest = der[kids[3][0]:sd_e]
    ep, ea, eb, _ = kids[2]
    eoid_end = read_tlv(der, ea)[4]
    eoid = der[ea:eoid_end]
    _, _, cs, ce, _ = read_tlv(der, eoid_end)                       # [0] around the OCTET STRING
    _, _, os_s, os_e, _ = read_tlv(der, cs)
    content = der[os_s:os_e]
    pieces = b"".join(b"\x04\x82" + min(1000, len(content) - p).to_bytes(2, "big") + content[p:p + 1000]
                      for p in range(0, len(content), 1000))
    encap_ber = indef(0x30, eoid + indef(0xA0, indef(0x24, pieces)))
    return indef(0x30, oid + indef(0xA0, indef(0x30, version + digests + encap_ber + rest)))


def build_p7m():
    key, cert = self_signed()
    fpr = (HERE / "fatturapa-fpr12.xml").read_bytes()
    batch = (HERE / "fatturapa-fpa12-batch.xml").read_bytes()
    der = sign(fpr, key, cert)
    (HERE / "fatturapa-fpr12.xml.p7m").write_bytes(der)
    ber = cms_to_ber(sign(batch, key, cert))
    (HERE / "fatturapa-fpa12-batch.xml.p7m").write_bytes(ber)
    b64 = base64.b64encode(der).decode()
    (HERE / "fatturapa-fpr12-base64.p7m").write_text("\n".join(b64[i:i + 64] for i in range(0, len(b64), 64)) + "\n")
    (HERE / "fatturapa-double.p7m").write_bytes(sign(der, key, cert))
    (HERE / "detached.p7m").write_bytes(sign(fpr, key, cert, detached=True))
    print("wrote 5 p7m files")


# ------------------------------------------------------------------ the rest

def build_misc():
    fpr = (HERE / "fatturapa-fpr12.xml").read_text(encoding="utf-8")
    latin = fpr.replace('encoding="UTF-8"', 'encoding="ISO-8859-1"')
    latin = latin.replace("Servizi di consulenza del mese di marzo 2024.", "Servizi di consulenza per l'attività di marzo, perché più utili.")
    (HERE / "fatturapa-latin1.xml").write_bytes(latin.encode("iso-8859-1"))
    peppol = (HERE / "ubl-invoice-peppol.xml").read_text(encoding="utf-8")
    inner = re.sub(r"^<\?xml[^>]*\?>\s*", "", peppol)
    sbdh = ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<sh:StandardBusinessDocument xmlns:sh="http://www.unece.org/cefact/namespaces/StandardBusinessDocumentHeader">\n'
            '  <sh:StandardBusinessDocumentHeader>\n'
            '    <sh:HeaderVersion>1.0</sh:HeaderVersion>\n'
            '    <sh:Sender><sh:Identifier Authority="iso6523-actorid-upis">0007:5560000000</sh:Identifier></sh:Sender>\n'
            '    <sh:Receiver><sh:Identifier Authority="iso6523-actorid-upis">0088:7300009999999</sh:Identifier></sh:Receiver>\n'
            '    <sh:DocumentIdentification><sh:Standard>urn:oasis:names:specification:ubl:schema:xsd:Invoice-2</sh:Standard>'
            '<sh:TypeVersion>2.1</sh:TypeVersion><sh:InstanceIdentifier>1b1ec5d4-0000-4000-8000-000000000001</sh:InstanceIdentifier>'
            '<sh:Type>Invoice</sh:Type><sh:CreationDateAndTime>2024-04-10T08:00:00Z</sh:CreationDateAndTime></sh:DocumentIdentification>\n'
            '  </sh:StandardBusinessDocumentHeader>\n'
            + inner + '</sh:StandardBusinessDocument>\n')
    (HERE / "peppol-sbdh.xml").write_text(sbdh, encoding="utf-8")
    print("wrote fatturapa-latin1.xml, peppol-sbdh.xml")


if __name__ == "__main__":
    build_pdfs()
    build_p7m()
    build_misc()
    sys.exit(0)
