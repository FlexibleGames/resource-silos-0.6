Resource Silo v1.8.1

Resource Silo
- 20x20-cell structure
- Top intake, bottom output
- Stores one locked material type
- Native Collector: stored Gold, Liquid Gold, and Gold Granulate are added to the native Gold balance and can be spent normally
- Gold Granulate is worth 4 per pixel (2 Liquid Gold condensed into 1)

Gas Silo
- 20x20-cell structure
- Bottom intake, top output
- Stores one locked gas type

Visuals
- Code-drawn warehouse body and transparent material tank
- Lightweight intake/output activity animation
- Build menu uses dedicated 16x16 PNG icons only

Research
- Logistics IV
- 50,000 Gold

Sandustry 0.6.0 compatibility
- Updated supported game version to 0.6.0.
- Confirmed in 0.6.0 game source: custom structure registration, raw shapes, processors, gold-removal hook events, and vanilla tech registration remain available.
- Existing silo IDs and stored material data are unchanged for save compatibility.
- MRF is optional with vanilla research fallback.
- In-game testing remains required; backup your save first.
