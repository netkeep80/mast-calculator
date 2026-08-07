# Historical regression registry

This registry explains why focused tests survive Architecture Foundation refactoring. A test listed here protects a known failure mode or an independent verification path; it must not be removed merely because files move.

| Failure mode / history | Owning tests | Canonical or invariant reinforcement | Foundation rule |
|---|---|---|---|
| Alternating modular geometry / wrong physical module topology | `geometry.test.js` | canonical topology counts; seeded `9N` invariant | preserve physical octahedral topology |
| Top-boundary equipment load disappearing (#32) | `issue-32-top-boundary-load.test.js` | heavy one-module canonical case | top mass must reach the natural top triangle and lower stack |
| Legacy arbitrary top forces leaking back into public input (#36) | `static-load-simplification-issue36.test.js`, `loads.test.js` | static/lateral/crane canonical cases | only explicit internal fixture load API may inject arbitrary point force |
| Fixed bolt preload scaled incorrectly with external demand | `preload-scaling-regression.test.js` | manual/auto joint canonical cases | preload remains fixed while external demand scales |
| Support reactions violating analytic statics | `support-reactions.test.js` | seeded global force equilibrium | global force/moment equilibrium must remain independent of solver layout |
| Global banded FEM and modular Schur divergence | `triple-solver-crosscheck.test.js`, `module-stack.test.js` | canonical Schur metrics; seeded agreement | independent solver paths must agree within numerical tolerance |
| Optimized solvers agreeing with each other but both being wrong | `triple-solver-crosscheck.test.js` using `reference-frame.js` | complete 6-DOF cross-check | dense reference solver is verification/test-support, not dead production code |
| Limits collapsing to 1 module / 1 kg | `limits-zero-regression.test.js` | capacity and height canonical cases | capacity searches must remain finite and physically non-degenerate |
| Mixed module diameters falling back to one global diameter | `mixed-module-diameters.test.js` | `mixed-diameters` canonical case | per-module diameter ownership is preserved through FEM, mass, joints and export |
| Joint auto-selection choosing invalid/undersized physical hardware | `joint-configurator.test.js`, `connections.test.js` | manual/auto joint canonical cases | selected physical joint must pass geometry + strength under the selected mode |
| Intermediate metric-thread sizes disappearing from catalogue (#19) | `issue19-durability-fasteners.test.js` | joint canonical cases | supported physical catalogue range remains explicit |
| Guy cables failing to redistribute/slacken under nonlinear loading (#23) | `guy-wires-issue23.test.js` | `multi-tier-guys` canonical case | nonlinear cable equilibrium and convergence are preserved |
| Static payload / lateral / horizontal boom semantics drifting (#36) | `static-payload-capacity.test.js`, `lateral-capacity.test.js`, `crane-boom-capacity.test.js` | three dedicated canonical projections | these are distinct physical limit cases and must not be conflated |
| Design package causing a second FEM run or losing physical geometry | `design-workspace.test.js`, `obj-export.test.js`, `eskd-export.test.js` | `design-package-obj-round-trip` canonical case | design/export is a pure projection from transferred calculation data |
| CI workflow policy drifting silently | `ci-policy.test.js` | architecture CI | general CI policy remains centralized rather than copied into issue-specific path snapshots |

## Removed during #51

`tests/issue36-ci-policy.test.js` was removed because it asserted concrete workflow/package strings for one historical issue. The engineering risk is now covered by the canonical static/lateral/crane cases and focused physics tests, while cross-workflow policy is owned centrally by `ci-policy.test.js`. Keeping the issue-specific path snapshot would make later package moves fail for the old implementation rather than for lost behaviour.
