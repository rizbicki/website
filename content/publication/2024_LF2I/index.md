---
title: "Likelihood-Free Frequentist Inference: Bridging Classical Statistics and Machine Learning for Reliable Simulator-Based Inference"
date: 2024-06-06T00:00:02
draft: false

# Authors. Comma separated list, e.g. `["Bob Smith", "David Jones"]`.
authors:
- N. Dalmasso
- L. Masserano
- D. Zhao
- admin
- A. B. Lee

# Publication type.
# Legend:
# 0 = Uncategorized
# 1 = Conference paper
# 2 = Journal article
# 3 = Manuscript
# 4 = Report
# 5 = Book
# 6 = Book section
publication_types: ["2"]

# Publication name and optional abbreviated version.
publication: "Electronic Journal of Statistics"
#publication_short = "In *EJS*"

# Abstract and optional shortened version.
abstract: "Many areas of science rely on simulators that implicitly encode intractable likelihood functions of complex systems. Classical statistical methods are poorly suited for these so-called likelihood-free inference (LFI) settings, especially outside asymptotic and low-dimensional regimes. At the same time, popular LFI methods - such as Approximate Bayesian Computation or more recent machine learning techniques - do not necessarily lead to valid scientific inference because they do not guarantee confidence sets with nominal coverage in general settings. In addition, LFI currently lacks practical diagnostic tools to check the actual coverage of computed confidence sets across the entire parameter space. In this work, we propose a modular inference framework that bridges classical statistics and modern machine learning to provide (i) a practical approach for constructing confidence sets with near finite-sample validity at any value of the unknown parameters, and (ii) interpretable diagnostics for estimating empirical coverage across the entire parameter space. We refer to this framework as likelihood-free frequentist inference (LF2I). Any method that defines a test statistic can leverage LF2I to create valid confidence sets and diagnostics without costly Monte Carlo or bootstrap samples at fixed parameter settings. We study two likelihood-based test statistics (ACORE and BFF) and demonstrate their performance on high-dimensional complex data."
abstract_short: ""

# Featured image thumbnail (optional)
featured: true
image:
  caption: ''
  focal_point: ""
  preview_only: false

# Is this a selected publication? (true/false)
featured: false

# Projects (optional).
#   Associate this publication with one or more of your projects.
#   Simply enter your project's filename without extension.
#   E.g. `projects = ["deep-learning"]` references `content/project/deep-learning.md`.
#   Otherwise, set `projects = []`.
# projects: []

# Tags (optional).
#   Set `tags = []` for no tags, or use the form `tags = ["A Tag", "Another Tag"]` for one or more tags.
tags: ["Machine Learning", "Likelihood-Free Inference", "Nonparametric Statistics", "LF2I"]

# Links (optional).
url_pdf: "https://projecteuclid.org/journals/electronic-journal-of-statistics/volume-18/issue-2/Likelihood-free-frequentist-inference--bridging-classical-statistics-and-machine/10.1214/24-EJS2307.full"
url_preprint: "https://arxiv.org/abs/2107.03920"
url_code: "https://github.com/lee-group-cmu/lf2i"
#url_dataset: "#"
#url_project: "#"
#url_slides: "#"
#url_video: "#"
#url_poster: "#"
#url_source: "#"

# Custom links (optional).
#   Uncomment line below to enable. For multiple links, use the form `[{...}, {...}, {...}]`.
#url_custom: [{name: "Custom Link", url: "http://example.org"}]

summary: We introduce Likelihood-Free Frequentist Inference (LF2I), a framework that bridges classical statistics and machine learning for valid confidence sets in complex, likelihood-free settings. LF2I provides confidence sets with near finite-sample validity and offers practical diagnostics for empirical coverage, ensuring reliable scientific inference without costly Monte Carlo or bootstrap methods.


# Does this page contain LaTeX math? (true/false)
math: true

# Does this page require source code highlighting? (true/false)
highlight: true
---
