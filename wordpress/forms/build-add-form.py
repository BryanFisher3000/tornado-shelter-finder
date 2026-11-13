#!/usr/bin/env python3
"""Writes the Add a Shelter form as a file Formidable Forms can import (Formidable > Import/Export).

    python3 wordpress/forms/build-add-form.py wordpress/forms/add-a-shelter-form.xml

The form is the one on the website's Add a Shelter page (/tornado-shelter-finder/add/): a field for
each of the app's Add a Shelter form. The review plugin (wordpress/sas-shelter-review) knows the form
by its field keys, sas_add_*, so change a key here only together with includes/formidable.php,
includes/account.php and assets/shelter-forms.js.

The layout is the one Formidable's own export writes (classes/views/xml/forms_xml.php, read by
FrmXMLHelper::import_xml): a <channel> holding one <form> and its <field>s. Field ids in the file
are only used to match fields on a second import, so they are large numbers no site will have.
Importing the file again updates the same form (it is matched by its key and created_at), and takes
out any field that was added to it by hand in the form builder.
"""
import json, sys

STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split()
THANKS = "Thanks! We got the new shelter. Our team will review it before it shows up in the Tornado Shelter Finder."
LEAD = "Our team reviews every new shelter before it shows up in the Tornado Shelter Finder."

FORM = {
    "id": 990000,
    "form_key": "sas_add_shelter",
    "name": "Add a Shelter",
    "description": LEAD,
    "created_at": "2026-11-13 04:00:00",
    "options": {
        "submit_value": "Add",
        "success_action": "message",
        "success_msg": THANKS,
        "show_form": 0,
        "show_title": 0,
        "show_description": 1,
        "custom_style": "sas",
        "antispam": 1,
    },
}

def text(key, name, required=False, **opts):
    return dict(key=key, name=name, type="text", required=required, opts=opts)

def radio(key, name, choices):
    return dict(key=key, name=name, type="radio", choices=choices, default="Unknown", opts={"align": "inline"})

def hidden(key, name):
    return dict(key=key, name=name, type="hidden")

FIELDS = [
    text("name", "Location Name", True, blank="Please add the location name.", placeholder="e.g. First Baptist Church Safe Room"),
    text("street", "Street Address", True, blank="Please add the street address.", autocomplete="off"),
    text("city", "City", True, blank="Please add the city.", classes="frm8 frm_first"),
    dict(key="state", name="State", type="select", required=True, choices=[""] + STATES,
         opts={"blank": "Please add the state.", "classes": "frm4", "placeholder": "State"}),
    text("zip", "ZIP", classes="frm4 frm_first", max="10"),
    hidden("county", "County"),
    hidden("lat", "Map pin latitude"),
    hidden("lng", "Map pin longitude"),
    radio("capacity", "Capacity", ["Unknown", "Under 25", "Under 50", "50 or more"]),
    radio("open", "Open", ["Unknown", "During emergencies", "Year-round"]),
    radio("ada", "Wheelchair accessible", ["Unknown", "Yes", "No"]),
    radio("pets", "Pets allowed", ["Unknown", "Yes", "No"]),
    dict(key="note", name="Comments", type="textarea", opts={"label": "none", "placeholder": "Anything to note", "max": "4"}),
    dict(key="info", name="My info", type="html", description="My info"),
    text("first", "First Name", True, blank="Please add the first name.", classes="frm6 frm_first", autocomplete="given-name"),
    text("last", "Last Name", True, blank="Please add the last name.", classes="frm6", autocomplete="family-name"),
    dict(key="email", name="Email", type="email", required=True,
         opts={"blank": "Please add the email.", "invalid": "Please add a valid email.", "autocomplete": "email"}),
    dict(key="submit", name="Add", type="submit", order=9999),
]

def cdata(s):
    s = str(s)
    assert "]]>" not in s
    return "<![CDATA[" + s + "]]>"

def js(v):
    return json.dumps(v, ensure_ascii=False, separators=(",", ":"))

def build():
    out = ['<?xml version="1.0" encoding="UTF-8" ?>', "<channel>",
           "\t<title>Tornado Shelter Finder: Add a Shelter form</title>",
           "\t<pubDate>Fri, 13 Nov 2026 04:00:00 +0000</pubDate>", "",
           "\t<form>",
           "\t\t<id>%d</id>" % FORM["id"],
           "\t\t<form_key>%s</form_key>" % cdata(FORM["form_key"]),
           "\t\t<name>%s</name>" % cdata(FORM["name"]),
           "\t\t<description>%s</description>" % cdata(FORM["description"]),
           "\t\t<created_at>%s</created_at>" % FORM["created_at"],
           "\t\t<logged_in>0</logged_in>",
           "\t\t<is_template>0</is_template>",
           "\t\t<editable>0</editable>",
           "\t\t<options>%s</options>" % cdata(js(FORM["options"])),
           "\t\t<status>%s</status>" % cdata("published"),
           "\t\t<parent_form_id>0</parent_form_id>"]
    for n, f in enumerate(FIELDS, start=1):
        opts = dict(f.get("opts") or {})
        if f.get("required"):
            opts.setdefault("required_indicator", "")  # no asterisk, like the app; the field is still required
        out += ["\t\t<field>",
                "\t\t\t<id>%d</id>" % (FORM["id"] + n),
                "\t\t\t<field_key>%s</field_key>" % cdata("sas_add_" + f["key"]),
                "\t\t\t<name>%s</name>" % cdata(f["name"]),
                "\t\t\t<description>%s</description>" % cdata(f.get("description", "")),
                "\t\t\t<type>%s</type>" % cdata(f["type"]),
                "\t\t\t<default_value>%s</default_value>" % cdata(f.get("default", "")),
                "\t\t\t<field_order>%d</field_order>" % f.get("order", n),
                "\t\t\t<form_id>%d</form_id>" % FORM["id"],
                "\t\t\t<required>%d</required>" % (1 if f.get("required") else 0),
                "\t\t\t<options>%s</options>" % cdata(js(f.get("choices", []))),
                "\t\t\t<field_options>%s</field_options>" % cdata(js(opts)),
                "\t\t</field>"]
    out += ["\t</form>", "</channel>", ""]
    return "\n".join(out)

if __name__ == "__main__":
    xml = build()
    path = sys.argv[1] if len(sys.argv) > 1 else None
    if path:
        open(path, "w", encoding="utf-8", newline="\n").write(xml)
    else:
        sys.stdout.write(xml)
