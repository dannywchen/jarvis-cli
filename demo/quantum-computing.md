# Quantum Computing and Information Processing

## Chapter 1: Foundations of Quantum Information

The Qubit is defined as the fundamental unit of quantum information, generalizing the classical binary digit to continuous state spaces. While a classical bit must reside strictly in state 0 or state 1, a qubit can exist in a linear superposition of both orthogonal basis states.

Superposition represents the mathematical principle allowing quantum states to exist simultaneously across multiple basis vectors. In mathematical terms, the state vector is represented as |ψ⟩ = α|0⟩ + β|1⟩, where the complex probability amplitudes satisfy |α|² + |β|² = 1.

Quantum Measurement denotes the physical act of observing an indeterminate quantum state, causing it to probabilistically collapse into one of its definite eigenstates according to the Born rule.

## Chapter 2: Multi-Qubit Systems and Quantum Entanglement

Quantum Entanglement refers to a physical phenomenon where pairs or groups of particles interact such that the quantum state of each particle cannot be described independently of the state of others, regardless of the distance separating them.

A Bell State represents a maximally entangled quantum state of two qubits. The canonical Bell state |Φ⁺⟩ demonstrates instantaneous non-local correlation when measured in identical bases.

No-Cloning Theorem establishes that it is physically impossible to create an identical copy of an arbitrary unknown quantum state. This fundamental theorem safeguards quantum cryptographic protocols like BB84 from eavesdropping.

## Chapter 3: Quantum Logic Gates and Algorithms

The Hadamard Gate transforms basis states |0⟩ and |1⟩ into equal superposition states |+⟩ and |-⟩, acting as the fundamental building block for quantum parallelism.

The CNOT Gate serves as a controlled logic operation that inverts the target qubit if and only if the control qubit is in state |1⟩. Together with single-qubit rotations, CNOT forms a universal set of quantum gates capable of approximating any unitary operation.

Shor Algorithm enables exponential speedup for integer prime factorization, posing a mathematical disruption to classical RSA asymmetric cryptography by computing discrete logarithms via the Quantum Fourier Transform.
