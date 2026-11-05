<?php if ( ! defined( 'ABSPATH' ) ) { exit; } ?>
<div id="sas-review">
<div class="app">
  <header class="top">
    <div class="brand">
      <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><path d="M17 2 L31 9 V17 C31 25 24.5 30.5 17 32 C9.5 30.5 3 25 3 17 V9 Z" fill="var(--accent)"/><path d="M9 13 H25 M11 17 H23 M13.5 21 H20.5 M15.5 25 H18.5" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>
      <div><div class="brand-name">Survive-A-Storm</div><div class="brand-title">Shelter Review</div></div>
    </div>
    <div class="who" id="who"><?php echo esc_html( sas_review_reviewer_name() ); ?></div>
  </header>

  <div id="app">
    <div class="sample-note" style="justify-content:space-between">
      <div class="views" role="group" aria-label="View">
        <button data-view="queue" aria-pressed="true">Review queue</button>
        <button data-view="subs" aria-pressed="false">All submissions</button>
        <button data-view="shelters" aria-pressed="false">Shelters</button>
        <button data-view="counties" aria-pressed="false">County contacts</button>
      </div>
      <div class="toolbar"><div class="stats" id="stats"></div><button class="reopen" id="refresh">Refresh</button></div>
    </div>

    <main id="view-queue" class="panes">
      <section class="pane queue" aria-label="Submission queue">
        <div class="qtabs" role="group" aria-label="Status" id="qtabs"></div>
        <div class="chips" role="group" aria-label="Kind" id="chips"></div>
        <div class="qsearch"><input id="q" type="search" placeholder="Search name, city, person or #" aria-label="Search submissions"></div>
        <ul class="qlist" id="qlist"></ul>
      </section>
      <section class="pane detail" id="detail" aria-live="polite"></section>
      <aside class="side" id="side"></aside>
    </main>

    <main id="view-subs" class="pane audit" hidden>
      <div class="pane-h"><h2>All submissions</h2><span class="mono" id="subs-count"></span></div>
      <div class="audit-tools"><input id="subq" type="search" placeholder="Search shelter, person, # or comment" aria-label="Search all submissions"><div class="chips" id="subs-tools" style="border:0;padding:0"></div></div>
      <div class="tablewrap" style="border:0;border-radius:0"><table class="log"><thead><tr><th>Sent</th><th>Kind</th><th>Shelter</th><th>Status</th><th>From</th><th>Decided</th></tr></thead><tbody id="subs-body"></tbody></table></div>
    </main>

    <main id="view-shelters" class="panes two" hidden>
      <section class="pane">
        <div class="pane-h"><h2>Shelters</h2><span class="mono" id="sh-count"></span></div>
        <div class="audit-tools"><input id="shq" type="search" placeholder="Name, address, city, county or id" aria-label="Search shelters"><input id="shstate" class="state-in" maxlength="2" placeholder="State" aria-label="State"><div class="chips" id="sh-tools" style="border:0;padding:0"></div></div>
        <div class="tablewrap" style="border:0;border-radius:0"><table class="log"><thead><tr><th>Shelter</th><th>Where</th><th>Status</th><th>Last change</th></tr></thead><tbody id="sh-body"></tbody></table></div>
      </section>
      <section class="pane detail" id="sh-edit" aria-live="polite"></section>
    </main>

    <main id="view-counties" class="panes two" hidden>
      <section class="pane">
        <div class="pane-h"><h2>County EM contacts</h2><span class="mono" id="co-count"></span></div>
        <div class="audit-tools"><input id="coq" type="search" placeholder="County, agency, director or email" aria-label="Search counties"><input id="costate" class="state-in" maxlength="2" placeholder="State" aria-label="State"><label class="chk"><input type="checkbox" id="comissing"> Missing a contact</label></div>
        <div class="tablewrap" style="border:0;border-radius:0"><table class="log"><thead><tr><th>County</th><th>Agency</th><th>Contact</th></tr></thead><tbody id="co-body"></tbody></table></div>
      </section>
      <section class="pane detail" id="co-edit" aria-live="polite"></section>
    </main>

    <div class="keys" id="keys"><span><kbd>J</kbd> <kbd>K</kbd> next / previous</span><span><kbd>A</kbd> approve</span><span><kbd>Q</kbd> ask a question</span><span><kbd>R</kbd> reject</span><span><kbd>Ctrl</kbd>+<kbd>Enter</kbd> confirm</span></div>
  </div>
</div>
<div class="toast" id="toast" hidden role="status"></div>
</div>
