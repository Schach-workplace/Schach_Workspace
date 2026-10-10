import { it, expect } from 'vitest';
import * as implementation from './history';
import { registerHistoryCases } from '../../../shared/communication/history.cases';
registerHistoryCases(it, expect, implementation);
