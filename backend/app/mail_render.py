"""Keep email layout while removing active content and remote CSS resources."""

import html
import re
from html.parser import HTMLParser
import bleach
from bleach.css_sanitizer import CSSSanitizer, ALLOWED_CSS_PROPERTIES
import tinycss2

CSS = CSSSanitizer(
    allowed_css_properties=ALLOWED_CSS_PROPERTIES
    | frozenset(
        {
            "width",
            "height",
            "max-width",
            "min-width",
            "max-height",
            "min-height",
            "margin",
            "margin-top",
            "margin-right",
            "margin-bottom",
            "margin-left",
            "padding",
            "padding-top",
            "padding-right",
            "padding-bottom",
            "padding-left",
            "border",
            "border-radius",
            "border-top",
            "border-bottom",
            "border-left",
            "border-right",
            "border-collapse",
            "border-spacing",
            "display",
            "table-layout",
            "overflow",
            "overflow-wrap",
            "word-break",
            "word-wrap",
            "box-sizing",
            "vertical-align",
            "text-decoration",
            "text-transform",
            "letter-spacing",
            "white-space",
            "opacity",
            "float",
            "clear",
            "background",
        }
    )
)


def safe_css(value):
    rules = tinycss2.parse_declaration_list(
        value, skip_comments=True, skip_whitespace=True
    )

    def safe(tokens):
        return all(
            t.type not in ("url", "error", "at-keyword")
            and not (
                t.type == "function"
                and (
                    t.lower_name
                    in ("url", "expression", "image-set", "-webkit-image-set")
                    or not safe(t.arguments)
                )
            )
            for t in tokens
        )

    return CSS.sanitize_css(
        tinycss2.serialize(
            [r for r in rules if r.type == "declaration" and safe(r.value)]
        )
    )


def stylesheet(value):
    result = []
    for rule in tinycss2.parse_stylesheet(
        value, skip_comments=True, skip_whitespace=True
    ):
        if rule.type == "qualified-rule":
            selector = tinycss2.serialize(rule.prelude)
            if "<" not in selector and len(selector) < 2000:
                result.append(
                    selector + "{" + safe_css(tinycss2.serialize(rule.content)) + "}"
                )
        elif (
            rule.type == "at-rule" and rule.lower_at_keyword == "media" and rule.content
        ):
            result.append(
                "@media "
                + tinycss2.serialize(rule.prelude)
                + "{"
                + stylesheet(tinycss2.serialize(rule.content))
                + "}"
            )
    return "".join(result).replace("<", "\\3c ")


class Prepare(HTMLParser):
    blocked = {
        "script",
        "iframe",
        "object",
        "embed",
        "svg",
        "math",
        "form",
        "button",
        "input",
        "textarea",
        "select",
        "title",
        "noscript",
    }

    def __init__(self, text=False):
        super().__init__(convert_charrefs=False)
        self.out = []
        self.skip = []
        self.style = None
        self.text = text

    def handle_starttag(self, tag, attrs):
        if self.skip:
            if tag in self.blocked and tag not in {"input", "embed"}:
                self.skip.append(tag)
            return
        if tag in self.blocked:
            if tag not in {"input", "embed"}:
                self.skip.append(tag)
        elif tag == "style":
            self.style = []
        elif not self.text:
            attrs = [
                (name, safe_css(value or "") if name == "style" else value)
                for name, value in attrs
            ]
            if tag == "a":
                attrs = [(k, v) for k, v in attrs if k not in ("target", "rel")] + [
                    ("target", "_blank"),
                    ("rel", "noopener noreferrer"),
                ]
            self.out.append(
                "<"
                + tag
                + "".join(
                    " " + k + '="' + html.escape(v or "", quote=True) + '"'
                    for k, v in attrs
                )
                + ">"
            )
        elif tag in {"p", "br", "div", "tr", "li"}:
            self.out.append("\n")

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if self.skip:
            if tag == self.skip[-1]:
                self.skip.pop()
        elif tag == "style":
            if self.style is not None and not self.text:
                self.out.append(
                    "<style>" + stylesheet("".join(self.style)) + "</style>"
                )
            self.style = None
        elif not self.text:
            self.out.append("</" + tag + ">")

    def handle_data(self, data):
        if self.skip:
            return
        if self.style is not None:
            self.style.append(data)
        else:
            self.out.append(data if self.text else html.escape(data))

    def handle_entityref(self, name):
        self.handle_data(html.unescape("&" + name + ";"))

    def handle_charref(self, name):
        self.handle_data(html.unescape("&#" + name + ";"))


def plain_text(value):
    parser = Prepare(text=True)
    parser.feed(value)
    return "\n".join(
        line.strip() for line in "".join(parser.out).splitlines() if line.strip()
    )


def sanitize_email(value):
    if re.match(r"^\s*&lt;(?:!doctype|html|div|table|p\b)", value, re.I):
        value = html.unescape(value)
    parser = Prepare()
    parser.feed(value)

    def attribute(tag, name, value):
        if name == "style":
            return True
        if name in {
            "class",
            "id",
            "title",
            "dir",
            "lang",
            "align",
            "valign",
            "width",
            "height",
            "bgcolor",
            "border",
            "cellpadding",
            "cellspacing",
            "colspan",
            "rowspan",
            "role",
            "aria-label",
        }:
            return True
        if tag == "a" and name in {"href", "target", "rel"}:
            return True
        if tag == "img" and name in {"alt", "src"}:
            return (
                name == "alt"
                or value.startswith(("https://", "http://", "cid:"))
                or bool(
                    re.match(r"^data:image/(?:png|jpeg|gif|webp);base64,", value, re.I)
                )
            )
        return False

    result = bleach.clean(
        "".join(parser.out),
        tags=[
            "style",
            "div",
            "span",
            "p",
            "br",
            "hr",
            "b",
            "strong",
            "em",
            "i",
            "u",
            "s",
            "ul",
            "ol",
            "li",
            "blockquote",
            "pre",
            "code",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "table",
            "thead",
            "tbody",
            "tfoot",
            "tr",
            "td",
            "th",
            "a",
            "img",
            "center",
            "font",
            "small",
            "sup",
            "sub",
        ],
        attributes=attribute,
        protocols=["https", "http", "mailto", "cid", "data"],
        css_sanitizer=CSS,
        strip=True,
        strip_comments=True,
    )
    # Sanitize inline declarations too, preventing URLs once remote images are enabled.
    return result
