import { Box, FormControl, FormControlLabel, FormLabel, Radio, RadioGroup, TextField, Typography } from '@mui/material'
import type { SpecLinkedQuantityBind } from '../../hooks/useSpecLinkedQuantityFields'

type LinkedQty = SpecLinkedQuantityBind

export function LinkedQuantityFields(props: {
  qty: LinkedQty
  /** Used when finish mode is Cartons and qty mode isn't KG — bound to product spec `bags_per_carton`. */
  bagsPerCartonStr: string
  onBagsPerCartonChange: (raw: string) => void
}) {
  const { qty, bagsPerCartonStr, onBagsPerCartonChange } = props

  const {
    finishMode,
    isContinuousLength,
    productUnitLabel,
    effectiveQtyType,
    qtyMode,
    totalKg,
    setTotalKg,
    numRolls,
    setNumRolls,
    weightPerRoll,
    setWeightPerRoll,
    numUnits,
    setNumUnits,
    numCartons,
    setNumCartons,
    unitsPerRoll,
    setUnitsPerRoll,
    metersPerRoll,
    setMetersPerRoll,
    totalKgEditable,
    unitsEditable,
    rollsEditable,
    weightPerRollEditable,
    haveDriverForTotalKg,
    haveDriverForWeightPerRoll,
    totalKgDisplay,
    rollsDisplay,
    weightPerRollDisplay,
    unitsDisplay,
    productsPerRollDerived,
    cartonCountForDisplay,
    totalMetersReadonly,
    applyQuantityCarryForNewQtyType,
    setQtyType,
    setCartonQtyMode,
    debouncedTotalProductsCascade,
    debouncedUnitsPerRollCascade,
    debouncedBagsPerCartonCascade,
    lastNumUnitsRawRef,
    lastUnitsPerRollRawRef,
    lastBagsPerCartonRawRef,
    continuousRollCountForTotalKgSync,
    derivedForDisplay,
    ratebook,
    formatKgDisplay,
    roundTo2Decimals,
    bagsPerCartonNum,
  } = qty

  const unitsPerRollNum = Math.max(0, Math.round(Number(unitsPerRoll || 0)))
  const weightPerRollNum = Number(weightPerRoll || 0)
  const numRollsNumLocal = Math.max(0, Math.round(Number(numRolls || 0)))

  const kgPerMFromDerived =
    derivedForDisplay?.derivedTotalM != null &&
    Number(derivedForDisplay.derivedTotalM) > 0 &&
    derivedForDisplay?.derivedTotalKg != null &&
    Number(derivedForDisplay.derivedTotalKg) > 0
      ? Number(derivedForDisplay.derivedTotalKg) / Number(derivedForDisplay.derivedTotalM)
      : null

  const cartonsHideNominalRollWeight = finishMode === 'Cartons'

  return (
    <>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2 }}>
        <FormControl component="fieldset">
          <FormLabel component="legend">Qty Type</FormLabel>
          <RadioGroup
            row
            value={qtyMode}
            onChange={(_e, v) => {
              if (v === 'units') {
                applyQuantityCarryForNewQtyType('units', '1000')
                setQtyType('units')
                if (finishMode === 'Cartons') setCartonQtyMode('1000')
              } else if (v === 'ctn') {
                applyQuantityCarryForNewQtyType('units', 'ctn')
                setQtyType('units')
                setCartonQtyMode('ctn')
              } else if (v === 'kg') {
                applyQuantityCarryForNewQtyType('kg')
                setQtyType('kg')
              } else if (finishMode === 'Rolls') {
                const nextQtyType = isContinuousLength
                  ? 'total_rolls'
                  : effectiveQtyType === 'rolls_units' || effectiveQtyType === 'total_rolls'
                    ? effectiveQtyType
                    : 'rolls_units'
                applyQuantityCarryForNewQtyType(nextQtyType)
                setQtyType(nextQtyType)
              }
            }}
          >
            <FormControlLabel
              value="units"
              control={<Radio />}
              label={
                isContinuousLength ? `total ${productUnitLabel.toLowerCase()}` : `1000 (total ${productUnitLabel.toLowerCase()})`
              }
            />
            <FormControlLabel value="kg" control={<Radio />} label="KG (total kg)" />
            {finishMode === 'Cartons' ? <FormControlLabel value="ctn" control={<Radio />} label="CTN" /> : null}
            {finishMode === 'Rolls' ? <FormControlLabel value="roll" control={<Radio />} label="ROLL" /> : null}
          </RadioGroup>
        </FormControl>
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        Quantity fields stay in sync (same behaviour as Quotes): editing one driver updates the related totals when
        geometry and ratebook data allow it.
      </Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 2, mt: 2 }}>
        <TextField label="Total Meters (derived)" value={totalMetersReadonly} disabled />

        <TextField
          label="Total KG"
          type="number"
          inputProps={{ min: 0, step: 0.1 }}
          value={
            totalKgEditable
              ? totalKg
              : haveDriverForTotalKg && totalKgDisplay != null
                ? formatKgDisplay(totalKgDisplay)
                : totalKg !== '' && Number.isFinite(Number(totalKg))
                  ? formatKgDisplay(Number(totalKg))
                  : totalKg
          }
          onChange={totalKgEditable ? (e) => setTotalKg(e.target.value) : undefined}
          disabled={!totalKgEditable}
          required={effectiveQtyType === 'kg'}
        />

        {finishMode === 'Rolls' ? (
          <TextField
            label={`${productUnitLabel} per roll`}
            type="number"
            inputProps={{ min: 0, step: effectiveQtyType === 'rolls_units' ? 1 : 'any' }}
            value={
              effectiveQtyType === 'rolls_units'
                ? unitsPerRoll
                : effectiveQtyType === 'total_rolls' && finishMode === 'Rolls' && !isContinuousLength
                  ? unitsPerRoll.trim() !== ''
                    ? unitsPerRoll
                    : productsPerRollDerived != null
                      ? String(Math.max(0, Math.floor(productsPerRollDerived)))
                      : ''
                  : effectiveQtyType === 'units' && finishMode === 'Rolls' && !isContinuousLength
                    ? unitsPerRoll.trim() !== ''
                      ? unitsPerRoll
                      : productsPerRollDerived != null
                        ? String(Math.max(0, Math.floor(productsPerRollDerived)))
                        : ''
                    : productsPerRollDerived != null
                      ? String(Math.max(0, Math.floor(productsPerRollDerived)))
                      : ''
            }
            onChange={(e) => {
              const raw = e.target.value
              lastUnitsPerRollRawRef.current = raw
              setUnitsPerRoll(raw)
              const stayDiscreteRollQty = finishMode === 'Rolls' && !isContinuousLength && effectiveQtyType === 'total_rolls'
              if (
                !(effectiveQtyType === 'units' && finishMode === 'Rolls' && !isContinuousLength) &&
                !stayDiscreteRollQty
              ) {
                setQtyType('rolls_units')
              }
              debouncedUnitsPerRollCascade()
            }}
            onBlur={() => debouncedUnitsPerRollCascade.flush()}
            disabled={
              (effectiveQtyType === 'total_rolls' && isContinuousLength) ||
              !(
                qtyMode === 'roll' ||
                effectiveQtyType === 'rolls_units' ||
                (effectiveQtyType === 'units' && finishMode === 'Rolls' && !isContinuousLength)
              )
            }
          />
        ) : (
          <TextField
            label={`${productUnitLabel} per Carton`}
            type="number"
            inputProps={{ min: 1, step: 1 }}
            value={bagsPerCartonStr}
            onChange={(e) => {
              const raw = e.target.value
              lastBagsPerCartonRawRef.current = raw
              onBagsPerCartonChange(raw)
              debouncedBagsPerCartonCascade()
            }}
            onBlur={() => debouncedBagsPerCartonCascade.flush()}
            disabled={finishMode === 'Cartons' && effectiveQtyType === 'kg'}
          />
        )}

        <TextField
          label={finishMode === 'Cartons' ? 'Weight per Carton (kg)' : 'Weight per Roll (kg)'}
          type="number"
          inputProps={{ min: 0, step: 'any' }}
          value={
            cartonsHideNominalRollWeight
              ? ''
              : weightPerRollEditable
                ? weightPerRoll
                : effectiveQtyType === 'rolls_units' && finishMode === 'Rolls'
                  ? weightPerRollDisplay != null
                    ? formatKgDisplay(weightPerRollDisplay)
                    : ''
                  : haveDriverForWeightPerRoll && weightPerRollDisplay != null
                    ? formatKgDisplay(weightPerRollDisplay)
                    : weightPerRoll !== '' && Number.isFinite(Number(weightPerRoll))
                      ? formatKgDisplay(Number(weightPerRoll))
                      : weightPerRoll
          }
          onChange={
            cartonsHideNominalRollWeight
              ? undefined
              : qtyMode === 'roll'
                ? (e) => {
                    setWeightPerRoll(e.target.value)
                    setQtyType('total_rolls')
                    const nextWpr = Number(e.target.value || 0)
                    if (isContinuousLength) {
                      if (kgPerMFromDerived != null && kgPerMFromDerived > 0 && nextWpr > 0) {
                        const mpr = nextWpr / kgPerMFromDerived
                        if (Number.isFinite(mpr) && mpr > 0) setMetersPerRoll(roundTo2Decimals(String(mpr)))
                      }
                      const rcRoll = continuousRollCountForTotalKgSync()
                      if (rcRoll != null && rcRoll > 0 && nextWpr > 0) {
                        setTotalKg(formatKgDisplay(nextWpr * rcRoll))
                      }
                    } else if (finishMode === 'Rolls' && numRollsNumLocal > 0 && nextWpr > 0) {
                      const nr = numRollsNumLocal
                      setTotalKg(formatKgDisplay(nr * nextWpr))
                      const b = unitsPerRollNum
                      if (b > 0) setNumUnits(String(nr * b))
                    }
                  }
                : isContinuousLength && finishMode === 'Rolls' && weightPerRollEditable
                  ? (e) => {
                      setWeightPerRoll(e.target.value)
                      const nextWpr = Number(e.target.value || 0)
                      if (kgPerMFromDerived != null && kgPerMFromDerived > 0 && nextWpr > 0) {
                        const mpr = nextWpr / kgPerMFromDerived
                        if (Number.isFinite(mpr) && mpr > 0) setMetersPerRoll(roundTo2Decimals(String(mpr)))
                      }
                      const rcKgUnits = continuousRollCountForTotalKgSync()
                      if (rcKgUnits != null && rcKgUnits > 0 && nextWpr > 0) {
                        setTotalKg(formatKgDisplay(nextWpr * rcKgUnits))
                      }
                    }
                  : weightPerRollEditable
                    ? (e) => {
                        const raw = e.target.value
                        setWeightPerRoll(raw)
                        if (finishMode === 'Rolls' && effectiveQtyType === 'kg' && !isContinuousLength && ratebook) {
                          const w = Number(raw)
                          const kpu = derivedForDisplay?.kgPerUnit
                          const tk = Number(totalKg || 0)
                          if (
                            raw.trim() !== '' &&
                            Number.isFinite(w) &&
                            w > 0 &&
                            kpu != null &&
                            Number.isFinite(Number(kpu)) &&
                            Number(kpu) > 0
                          ) {
                            setUnitsPerRoll(String(Math.max(1, Math.round(w / Number(kpu)))))
                          }
                          if (raw.trim() !== '' && Number.isFinite(w) && w > 0 && tk > 0) {
                            setNumRolls(String(Math.max(1, Math.round(tk / w))))
                          }
                        }
                      }
                    : undefined
          }
          disabled={
            cartonsHideNominalRollWeight
              ? true
              : finishMode === 'Rolls' && qtyMode === 'roll' && !isContinuousLength
                ? true
                : qtyMode === 'roll'
                  ? false
                  : !weightPerRollEditable
          }
        />

        <TextField
          label={finishMode === 'Cartons' ? 'No. of Cartons' : 'No. of Rolls'}
          type="number"
          inputProps={{ min: 0, step: 1 }}
          value={
            finishMode === 'Cartons' && qtyMode === 'ctn'
              ? numCartons
              : rollsEditable
                ? numRolls
                : rollsDisplay != null
                  ? String(rollsDisplay)
                  : finishMode === 'Cartons' && cartonCountForDisplay != null
                    ? String(cartonCountForDisplay)
                    : numRolls
          }
          onChange={
            finishMode === 'Cartons' && qtyMode === 'ctn'
              ? (e) => {
                  const raw = e.target.value
                  setNumCartons(raw)
                  const c = raw.trim() !== '' ? Math.max(0, Math.round(Number(raw))) : 0
                  const bpc = bagsPerCartonNum
                  const kpu = derivedForDisplay?.kgPerUnit
                  if (c > 0 && bpc > 0 && kpu != null && Number.isFinite(Number(kpu)) && Number(kpu) > 0) {
                    const wKg = bpc * Number(kpu)
                    setNumUnits(String(c * bpc))
                    setTotalKg(formatKgDisplay(c * wKg))
                  }
                }
              : rollsEditable
                ? (e) => {
                    const raw = e.target.value
                    setNumRolls(raw)
                    const r = raw.trim() !== '' ? Math.max(0, Math.round(Number(raw))) : 0
                    if (
                      finishMode === 'Rolls' &&
                      !isContinuousLength &&
                      effectiveQtyType === 'total_rolls' &&
                      unitsPerRollNum > 0 &&
                      r > 0 &&
                      ratebook
                    ) {
                      const b = unitsPerRollNum
                      setNumUnits(String(r * b))
                      const kpu = derivedForDisplay?.kgPerUnit
                      if (kpu != null && Number.isFinite(Number(kpu)) && Number(kpu) > 0) {
                        setTotalKg(formatKgDisplay(r * b * Number(kpu)))
                      } else if (weightPerRollNum > 0) {
                        setTotalKg(formatKgDisplay(r * weightPerRollNum))
                      }
                    }
                  }
                : undefined
          }
          disabled={finishMode === 'Cartons' && qtyMode === 'ctn' ? false : !rollsEditable}
          required
        />

        <TextField
          label="Total products"
          type="number"
          inputProps={{ min: 0, step: 1 }}
          sx={finishMode === 'Cartons' ? { gridColumn: '1 / -1' } : undefined}
          value={
            unitsEditable && !(finishMode === 'Cartons' && qtyMode === 'ctn')
              ? numUnits
              : unitsDisplay != null && Number.isFinite(Number(unitsDisplay))
                ? String(Math.round(Number(unitsDisplay)))
                : numUnits !== '' && Number.isFinite(Number(numUnits))
                  ? String(Math.round(Number(numUnits)))
                  : ''
          }
          onChange={
            unitsEditable && !(finishMode === 'Cartons' && qtyMode === 'ctn')
              ? (e) => {
                  const raw = e.target.value
                  lastNumUnitsRawRef.current = raw
                  setNumUnits(raw)
                  debouncedTotalProductsCascade()
                }
              : undefined
          }
          onBlur={
            unitsEditable && !(finishMode === 'Cartons' && qtyMode === 'ctn')
              ? () => debouncedTotalProductsCascade.flush()
              : undefined
          }
          disabled={!unitsEditable || (finishMode === 'Cartons' && qtyMode === 'ctn')}
        />

        {finishMode === 'Rolls' && isContinuousLength ? (
          <TextField
            label="Meters per roll"
            type="number"
            inputProps={{ min: 0, step: 'any' }}
            value={metersPerRoll}
            onChange={(e) => {
              const raw = e.target.value
              setMetersPerRoll(raw)
              const mpr = Number(raw || 0)
              const totalM =
                derivedForDisplay?.derivedTotalM != null && Number.isFinite(Number(derivedForDisplay.derivedTotalM))
                  ? Number(derivedForDisplay.derivedTotalM)
                  : null
              const totalKgSnap =
                derivedForDisplay?.derivedTotalKg != null && Number.isFinite(Number(derivedForDisplay.derivedTotalKg))
                  ? Number(derivedForDisplay.derivedTotalKg)
                  : null
              const kgPerM =
                totalM != null && totalM > 0 && totalKgSnap != null && totalKgSnap > 0 ? totalKgSnap / totalM : null
              if (kgPerM != null && Number.isFinite(kgPerM) && kgPerM > 0 && mpr > 0) {
                setWeightPerRoll(roundTo2Decimals(String(mpr * kgPerM)))
              }
              const rcRoll = continuousRollCountForTotalKgSync()
              if (rcRoll != null && rcRoll > 0 && mpr > 0 && kgPerM != null && Number.isFinite(kgPerM) && kgPerM > 0) {
                setTotalKg(formatKgDisplay(rcRoll * mpr * kgPerM))
              }
            }}
            sx={{ gridColumn: '1 / -1' }}
          />
        ) : null}
      </Box>
    </>
  )
}
