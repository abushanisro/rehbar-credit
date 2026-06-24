from types import SimpleNamespace

from app.extractors.cibil_parser import parse_cibil


def test_relationship_pan_parsing_with_pan_no_label():
    pages = [
        SimpleNamespace(
            text="""
Relationship 1
Name: MANSOOR ALI
Type: Director
Relationship: Promoter
PAN No.: ADMPM1794J

Relationship 2
Name: SHARMILA BANU
Type: Director
Relationship: Promoter
PAN No.: AVCPS0811Q
""",
            tables=[],
        )
    ]

    result = parse_cibil(pages)

    assert "relationships" in result
    assert len(result["relationships"]) == 2
    pans = [rel.get("pan") for rel in result["relationships"]]
    assert pans == ["ADMPM1794J", "AVCPS0811Q"]


def test_crif_consumer_report_parsing():
    pages = [
        SimpleNamespace(
            text="""
CONSUMER BASE™ REPORT
For JABIR K
CHM Ref #: ECW 230519CR549348726
Prepared For: ECW CONSULTANTS PVT LTD
Application ID: -
Date of Request: 19-05-2023
Date of Issue: 19-05-2023
Inquiry Input Information
Name: JABIR K DOB/Age: 01-06-1990 Gender: MALE
Father: MUHAMMED Spouse: Mother:
Phone Numbers: ID(s): CPXPK4319E [PAN] Email ID(s):
Entity Id:
Current Address: Mottammal, Adivaram, Puthuppadi, Kozhikode KOZHIKODE KOZHIKODE 673586 KL
Other Address:
CRIF HM Score(S):
SCORE NAME  SCORE SCORING FACTORS
PERFORM CONSUMER 2.0  722 Score Range : 300-900
""",
            tables=[],
        )
    ]

    result = parse_cibil(pages)

    assert result["borrower"]["name"] == "JABIR K"
    assert result["borrower"]["pan"] == "CPXPK4319E"
    assert result["report_order_no"] == "ECW 230519CR549348726"
    assert result["report_date"] == "19-05-2023"
    assert result["rank"]["value"] == "722"
    assert result["rank"]["name"].startswith("PERFORM CONSUMER")
