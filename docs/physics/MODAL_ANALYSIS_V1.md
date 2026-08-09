# Modal FEM foundation `frame-lumped-translational-v1`

Status: modal foundation for #100 / parent #97. This model computes structural natural frequencies and modal participation. It does **not** yet add SP 20 pulsation or dynamic wind load to the operational load case.

## Governing eigenproblem

The production 3D frame stiffness matrix is reused without an alternate structural geometry:

```text
K φ = ω² M φ
```

The numerical solver is implemented as the reciprocal generalized problem

```text
M φ = μ K φ,  μ = 1 / ω²
```

so the already validated symmetric-band Cholesky factorization of `K` can be reused. The largest positive `μ` values are the lowest physical frequencies. Production `K` and `M` remain banded; only the small Rayleigh–Ritz projection is diagonalized as a dense symmetric matrix.

Every returned mode contains both the generalized-eigen residual and the residual of the original dynamic equation `Kφ - ω²Mφ = 0`.

## Mass model identity

The first explicit mass model is:

```text
frame-lumped-translational-v1
```

It is a diagonal nodal lumped translational mass matrix. Each frame member contributes its physical mass equally to its two real end nodes. The three translational DOFs of a node receive the same nodal mass. Rotational inertia is not included in v1.

This is a deliberate global-mode model for the current finely discretized modular mast. The omission of rotational inertia is recorded in result provenance rather than hidden.

## Physical mass components

Included in `M`:

- reinforcement/steel member mass `ρ A L` from the actual member geometry and density;
- physical ice mass from the configured ice thickness and density;
- physical top-equipment mass distributed over the actual top nodes.

Not included in v1:

- connection bolt/nut/weld hardware mass;
- rotational mass inertia of the frame cross sections;
- any fictitious aerodynamic or reliability mass.

The result reports included physical mass components and the active translational mass after support restraints.

## Reliability factors are not inertia

The modal mass path intentionally does **not** use:

- `deadLoadFactor`;
- `equipmentLoadFactor`;
- `windLoadFactor`;
- material safety factors or combination factors.

Those coefficients belong to design load/reliability semantics. Multiplying physical inertia mass by them would corrupt the eigenproblem. Regression tests explicitly change these factors and require identical natural frequencies.

## Normalization and participation

Returned mode shapes are mass-normalized:

```text
φᵀ M φ = 1
```

For each global translation direction `r`, the result exposes effective modal mass:

```text
m_eff = (φᵀ M r)² / (φᵀ M φ)
```

and its ratio to active translational mass in that direction. This is the quantity needed by the subsequent SP 20 pulsation/modal-response slice; scalar `totalMassKg` is never treated as modal mass.

## Verification gates

The retained regression set covers:

1. exact diagonal generalized eigenvalues;
2. an exact coupled 2-DOF eigenproblem;
3. the analytical 1-DOF spring-mass frequency `f = sqrt(k/m)/(2π)`;
4. positive-semidefinite mass/operator handling;
5. production-mast first mode against an independent dense generalized-eigen reference;
6. finite/ordered modes and residuals;
7. physical top mass lowering the first frequency;
8. invariance of inertia frequencies to design reliability factors.

## Boundary of validity

This model is a prerequisite for #97, not a claim that SP 20 dynamic wind response is complete. Damping/decrement, pulsation spectrum/spatial correlation, regime selection, dynamic amplification and modal combination remain separate work.

A future mass-model revision that adds consistent frame mass, rotational inertia or connection-hardware mass must receive a new model identifier and its own numerical validation; it must not silently change `frame-lumped-translational-v1` semantics.
