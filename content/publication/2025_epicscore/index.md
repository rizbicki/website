---
abstract: Conformal prediction methods create prediction bands with distribution-free guarantees but do not explicitly capture epistemic uncertainty, which can lead to overconfident predictions in data-sparse regions. Although recent conformal scores have been developed to address this limitation, they are typically designed for specific tasks, such as regression or quantile regression. Moreover, they rely on particular modeling choices for epistemic uncertainty, restricting their applicability.
We introduce EPICSCORE, a model-agnostic approach that enhances any conformal score by explicitly integrating epistemic uncertainty. Leveraging Bayesian techniques—such as Gaussian Processes, Monte Carlo Dropout, or Bayesian Additive Regression Trees—EPICSCORE adaptively expands predictive intervals in regions with limited data while maintaining compact intervals where data is abundant. As with any conformal method, it preserves finite-sample marginal coverage and also achieves asymptotic conditional coverage. Experiments demonstrate its good performance compared to existing methods. Designed for compatibility with any Bayesian model but equipped with distribution-free guarantees, EPICSCORE provides a general-purpose framework for uncertainty quantification in prediction problems.

authors:
- L. M. C. Cabezas
- V. S. Santos
- T. R. Ramos
- admin
date: "2025-05-01T00:00:00Z"
doi: ""
featured: true
image:
  caption: ''
  focal_point: ""
  preview_only: false
publication: "Proceedings of Machine Learning (UAI Track; Oral Presentation)"
#publication_short: In *Journal of Machine Learning Research*
publication_types:
- "2"
publishDate: "2022-05-01T00:00:00Z"
project: 
slides: 
summary: WE introduce EPICSCORE, a model-agnostic method that enhances conformal prediction by integrating epistemic uncertainty. Compatible with any Bayesian model and maintaining distribution-free guarantees, EPICSCORE adapts prediction intervals based on data availability, achieving both finite-sample marginal and asymptotic conditional coverage.
tags: [Conformal prediction,Machine Learning,Regression Trees,Epistemic Uncertainty]
title: 'Epistemic Uncertainty in Conformal Scores: A Unified Approach'
url_code: "https://github.com/Monoxido45/EPICSCORE"
url_dataset: ""
url_pdf: "https://arxiv.org/abs/2502.06995"
url_poster: ""
url_project: ""
url_slides: ""
url_source: ""
url_video: ""
---
