(function () {
  // Inject global styling once
  const STYLE_ID = 'nsutils-global-styles';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.type = 'text/css';
    style.textContent = `

/* Table cell spacing: margin does NOT work on <td> in most browsers. Use padding for inner spacing, border-spacing for between cells. */
.uir-fieldgroup-content td {
  background-color: #f2f1ef;
  height: auto !important;
  width: auto !important;
  padding: 0.5rem !important; /* Use padding for inner spacing */
  }
  
  .uir-fieldgroup-content{
    border-radius: 3rem !important;
    overflow: hidden !important;
}

.table_fields {
  border-spacing: 0rem !important; /* Space between cells */
  border-collapse: separate !important;
}

.formsubtabtext {
  height: 100%;
  text-align: center;
  display: flex;
  align-items: center;
  padding: 0.3rem 1rem 0 1rem !important;
}

.formsubtaboff:hover,
.formsubtabtext:hover {
  background-color: rgb(230, 230, 230);
}

.formsubtabsep{
  display: none;
}

.formsubtabtexton{
  background-color: white;
}

.uir-tab-content-dot{
  display: none !important;
}



.uir-tabs .formtaboff,
.uir-tabs .formtabon {
  display: flex !important;
  align-items: stretch !important;
  height: 48px !important;   /* not min-height */
  min-height: 48px !important;
  border: none !important;
  }
  
  .uir-tabs .formtaboff > a,
  .uir-tabs .formtabon > a {
    display: flex;
    flex: 1 1 auto;
    width: 100%;
    height: 100%;
    align-items: center;
    justify-content: center;
    text-decoration: none;
    color: inherit;
    padding: 0 12px;
    border: none !important;
}

.uir-tabs .formtabon > a {
  box-shadow: inset 0 -3px 0 rgb(29, 107, 141) !important;
}

  

.formtabsep{
width: 0rem !important;
}

.formtaboff a:hover, .formtabon a:hover {
  background-color: rgb(230, 230, 230) !important;
}
`;
    document.head.appendChild(style);
  }
})();

(function () {
  // Collect both error message blocks and readonly textarea field spans
  const errorNodes = Array.from(document.querySelectorAll(".uir-error-page-message"));
  const fieldNodes = Array.from(document.querySelectorAll("td span.uir-field.inputreadonly.uir-resizable, span.uir-field.inputreadonly.uir-resizable"));
  const targets = [...errorNodes, ...fieldNodes];

  targets.forEach(div => {
    // Skip if already processed
    if (div.dataset && div.dataset.nsjsonformatted === "true") return;

    // Use textContent for searching JSON, but we'll reconstruct visual blocks below
    const text = div.textContent;

    const match = text.match(/{.*}/s);
    if (!match) return;

    try {
      const parsed = JSON.parse(match[0]);

      // Determine if this is a field span or an error block
      const isField = div.matches('span.uir-field.inputreadonly.uir-resizable');

      // Container
      const container = document.createElement("div");
      container.style.fontFamily = "monospace";
      container.style.fontSize = "13px";
      container.style.display = "block";

      if (isField) {
        // --- FIELD: show before text, JSON box (max-width 50%), then after text below ---
        const pretty = JSON.stringify(parsed, null, 2);

        const pre = document.createElement("pre");
        pre.textContent = pretty;
        pre.style.background = "#1e1e1e";
        pre.style.color = "#dcdcdc";
        pre.style.padding = "10px";
        pre.style.borderRadius = "6px";
        pre.style.overflowX = "auto";
        pre.style.margin = "0 0 6px 0";

        const copyButton = document.createElement("button");
        copyButton.textContent = "Copy JSON";
        copyButton.style.display = "inline-block";
        copyButton.style.marginTop = "6px";
        copyButton.style.padding = "5px 10px";
        copyButton.style.borderRadius = "4px";
        copyButton.style.border = "none";
        copyButton.style.background = "#61AFEF";
        copyButton.style.color = "#fff";
        copyButton.style.cursor = "pointer";

        copyButton.addEventListener("click", async () => {
          const content = pretty;
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              await navigator.clipboard.writeText(content);
            } else {
              const ta = document.createElement("textarea");
              ta.value = content;
              document.body.appendChild(ta);
              ta.select();
              document.execCommand("copy");
              document.body.removeChild(ta);
            }
            copyButton.textContent = "Copied!";
            setTimeout(() => copyButton.textContent = "Copy JSON", 1500);
          } catch (_) {
            copyButton.textContent = "Copy failed";
            setTimeout(() => copyButton.textContent = "Copy JSON", 1500);
          }
        });

        // Create wrapper for JSON box and button; apply max width 50% as requested
        const jsonBox = document.createElement("div");
        jsonBox.style.display = "block";
        // jsonBox.style.maxWidth = "50%";    // <--- max width set here
        jsonBox.style.width = "100%";
        jsonBox.style.boxSizing = "border-box";
        jsonBox.style.clear = "both";      // ensure it sits on its own line
        jsonBox.appendChild(pre);
        jsonBox.appendChild(copyButton);

        // Split original text into before/after around the matched JSON
        const idx = text.indexOf(match[0]);
        const beforeText = idx >= 0 ? text.slice(0, idx).trim() : "";
        const afterText = idx >= 0 ? text.slice(idx + match[0].length).trim() : "";

        // Create paragraphs for before and after text, if any
        if (beforeText) {
          const beforeP = document.createElement("div");
          beforeP.textContent = beforeText;
          beforeP.style.marginBottom = "8px";
          container.appendChild(beforeP);
        }

        container.appendChild(jsonBox);

        if (afterText) {
          const afterP = document.createElement("div");
          afterP.textContent = afterText;
          afterP.style.marginTop = "8px";
          container.appendChild(afterP);
        }

      } else {
        // --- ERROR BLOCK: rich UI (unchanged behavior except small DOM changes) ---
        const jsonCopy = structuredClone(parsed);
        delete jsonCopy.stack;
        if (jsonCopy.cause) delete jsonCopy.cause.stackTrace;

        const pre = document.createElement("pre");
        pre.style.background = "#1e1e1e";
        pre.style.color = "#dcdcdc";
        pre.style.padding = "10px";
        pre.style.borderRadius = "6px";
        pre.style.overflowX = "auto";

        let pretty = JSON.stringify(jsonCopy, null, 2)
          .replace(/"(name)":\s*"([^"]+)"/g, '"$1": "<span style="color:#C678DD;">$2</span>"')
          .replace(/"(message)":\s*"([^"]+)"/g, '"$1": "<span style="color:#FF474D;">$2</span>"');

        pre.innerHTML = pretty;
        container.appendChild(pre);

        function renderStack(title, stackArray) {
          if (!stackArray || !stackArray.length) return;
          const section = document.createElement("div");
          section.style.marginTop = "10px";

          const heading = document.createElement("div");
          heading.textContent = title + ":";
          heading.style.fontWeight = "bold";
          heading.style.marginBottom = "4px";
          section.appendChild(heading);

          const list = document.createElement("div");
          list.style.background = "#252526";
          list.style.color = "#dcdcdc";
          list.style.padding = "8px";
          list.style.borderRadius = "6px";
          list.style.whiteSpace = "pre";
          list.style.overflowX = "auto";

          stackArray.forEach(frame => {
            frame.split("\n").forEach(line => {
              const divLine = document.createElement("div");

              let html = line
                .replace(/^\s*at\s+([^\s(]+)/, (m, fn) => `at <span style="color:#98C379;">${fn}</span>`)
                .replace(/\/([^\/]+\.js)/g, '/<span style="color:#4FC3F7;">$1</span>')
                .replace(/:(\d+):(\d+)/g, ':<span style="color:#F78C6C;">$1:$2</span>');

              divLine.innerHTML = html;
              list.appendChild(divLine);
            });
          });

          section.appendChild(list);
          container.appendChild(section);
        }

        renderStack("Stack", parsed.stack);
        if (parsed.cause) {
          renderStack("Cause Stack Trace", parsed.cause.stackTrace);
        }

        const rawSection = document.createElement("div");
        rawSection.style.marginTop = "10px";

        const rawHeading = document.createElement("div");
        rawHeading.textContent = "Raw JSON:";
        rawHeading.style.fontWeight = "bold";
        rawHeading.style.marginBottom = "4px";
        rawSection.appendChild(rawHeading);

        const copyButton = document.createElement("button");
        copyButton.textContent = "Copy JSON";
        copyButton.style.marginBottom = "5px";
        copyButton.style.padding = "5px 10px";
        copyButton.style.borderRadius = "4px";
        copyButton.style.border = "none";
        copyButton.style.background = "#61AFEF";
        copyButton.style.color = "#fff";
        copyButton.style.cursor = "pointer";

        rawSection.appendChild(copyButton);

        const rawTextarea = document.createElement("textarea");
        rawTextarea.value = JSON.stringify(parsed, null, 2);
        rawTextarea.style.width = "100%";
        rawTextarea.style.height = "200px";
        rawTextarea.style.fontFamily = "monospace";
        rawTextarea.style.fontSize = "13px";
        rawTextarea.style.padding = "10px";
        rawTextarea.style.borderRadius = "6px";
        rawTextarea.style.border = "1px solid #444";
        rawTextarea.style.background = "#1e1e1e";
        rawTextarea.style.color = "#dcdcdc";
        rawTextarea.readOnly = true;

        rawSection.appendChild(rawTextarea);

        copyButton.addEventListener("click", () => {
          rawTextarea.select();
          document.execCommand("copy");
          copyButton.textContent = "Copied!";
          setTimeout(() => copyButton.textContent = "Copy JSON", 1500);
        });

        container.appendChild(rawSection);
      }

      // Replace old content: remove the matched JSON text from the original text and append our container
      // For safety, use the text-based split we created earlier for fields; for errors we remove the JSON snippet from innerHTML
      if (isField) {
        // We already built container with before/after paragraphs, so wipe the element and append container
        div.innerHTML = "";
        div.appendChild(container);
      } else {
        // For error blocks remove only the matched JSON snippet from the existing HTML and append the rich UI
        div.innerHTML = div.innerHTML.replace(match[0], "");
        div.appendChild(container);
      }

      // Mark as processed to avoid duplicate work
      if (div.dataset) div.dataset.nsjsonformatted = "true";

    } catch (e) {
      console.warn("Could not parse JSON in error message:", e);
    }
  });
})();