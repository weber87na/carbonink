#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { callBridge } from './bridge-client.js';
import { openAppDb } from './db.js';
import * as q from './queries.js';

const server = new Server(
  { name: 'carbonink', version: '0.1.0' },
  { capabilities: { tools: {}, resources: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_questionnaires',
      description: 'List all questionnaires (customer / reporting_year / status / question_count).',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: 'get_questionnaire',
      description:
        'Get the full detail of one questionnaire (includes customer / document / questions[]).',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'questionnaire id' },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
    {
      name: 'list_questions',
      description: 'List every question in a questionnaire.',
      inputSchema: {
        type: 'object',
        properties: {
          questionnaire_id: { type: 'string', description: 'questionnaire id' },
        },
        required: ['questionnaire_id'],
        additionalProperties: false,
      },
    },
    {
      name: 'get_answer',
      description: 'Get the answer to a question (returns null when unanswered).',
      inputSchema: {
        type: 'object',
        properties: {
          question_id: { type: 'string', description: 'question id' },
        },
        required: ['question_id'],
        additionalProperties: false,
      },
    },
    {
      name: 'list_activities',
      description: 'List activity data, optionally filtered by reporting_period_id or year.',
      inputSchema: {
        type: 'object',
        properties: {
          reporting_period_id: { type: 'string', description: 'reporting period id (optional)' },
          year: { type: 'number', description: 'reporting year, e.g. 2024 (optional)' },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'list_emission_sources',
      description: 'List emission sources, optionally filtered by organization_id.',
      inputSchema: {
        type: 'object',
        properties: {
          organization_id: { type: 'string', description: 'organization id (optional)' },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'set_answer',
      description:
        'Create or update the answer to a question. Recorded as ai_suggested, not manual. ' +
        'Requires the CarbonInk desktop app to be running.',
      inputSchema: {
        type: 'object',
        properties: {
          question_id: { type: 'string', description: 'question id' },
          value: { type: 'string', description: 'answer text' },
          unit: { type: 'string', description: 'unit (optional)', nullable: true },
          finalize: {
            type: 'boolean',
            description: 'mark the answer finalized (sets finalized_at)',
          },
        },
        required: ['question_id', 'value'],
        additionalProperties: false,
      },
    },
    {
      name: 'create_activity',
      description:
        'Create an activity data row. co2e is computed from the pinned emission factor, ' +
        "converting the given unit into the factor's unit; a cross-family unit (e.g. " +
        'litres against a per-kg factor) fails unless fuel_code is supplied. If the EF ' +
        'has not been pinned yet, use it once in the CarbonInk GUI first. Requires the ' +
        'CarbonInk desktop app to be running.',
      inputSchema: {
        type: 'object',
        properties: {
          emission_source_id: { type: 'string' },
          reporting_period_id: { type: 'string' },
          occurred_at_start: { type: 'string', description: 'ISO date string, e.g. 2024-01-01' },
          occurred_at_end: { type: 'string', description: 'ISO date string, e.g. 2024-12-31' },
          amount: { type: 'number' },
          unit: { type: 'string' },
          ef_factor_code: { type: 'string' },
          ef_year: { type: 'number' },
          ef_source: { type: 'string' },
          ef_geography: { type: 'string' },
          ef_dataset_version: { type: 'string' },
          fuel_code: {
            type: 'string',
            description:
              'Fuel binding for cross-family conversion (e.g. litres of diesel against a ' +
              'per-kg factor). Only needed when unit and the factor unit differ in family.',
            nullable: true,
          },
          notes: { type: 'string', nullable: true },
        },
        required: [
          'emission_source_id',
          'reporting_period_id',
          'occurred_at_start',
          'occurred_at_end',
          'amount',
          'unit',
          'ef_factor_code',
          'ef_year',
          'ef_source',
          'ef_geography',
          'ef_dataset_version',
        ],
        additionalProperties: false,
      },
    },
    {
      name: 'create_emission_source',
      description: 'Create an emission source. Requires the CarbonInk desktop app to be running.',
      inputSchema: {
        type: 'object',
        properties: {
          site_id: { type: 'string' },
          name: { type: 'string' },
          scope: { type: 'number', enum: [1, 2, 3] },
          category: { type: 'string', nullable: true },
          ghg_protocol_path: { type: 'string', nullable: true },
        },
        required: ['site_id', 'name', 'scope'],
        additionalProperties: false,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = (request.params.arguments ?? {}) as Record<string, unknown>;

  // Writes never touch this process's SQLite handle — they go over the agent
  // bridge into the app's own IPC handlers, so an agent's change gets the same
  // EF pinning, unit conversion, CO2e computation, audit event and undo entry
  // as an edit made in the UI (spec 2026-08-13-mcp-write-path-integrity).
  // Handled before openAppDb() so a write attempt with the app closed reports
  // "start CarbonInk" rather than a database error.
  switch (request.params.name) {
    case 'set_answer':
      return ok(
        await callBridge('answer:save', {
          question_id: String(args['question_id']),
          value: String(args['value']),
          unit: args['unit'] === undefined ? null : (args['unit'] as string | null),
          finalize: args['finalize'] === true,
          source_kind: 'ai_suggested',
        }),
      );

    case 'create_activity':
      return ok(await callBridge('activity:create', args));

    case 'create_emission_source':
      return ok(await callBridge('source:create', args));
  }

  const rawDb = openAppDb();
  const db = rawDb as unknown as q.DbLike;
  try {
    switch (request.params.name) {
      case 'list_questionnaires':
        return ok(q.listQuestionnaires(db));

      case 'get_questionnaire':
        return ok(q.getQuestionnaire(db, String(args['id'])));

      case 'list_questions':
        return ok(q.listQuestions(db, String(args['questionnaire_id'])));

      case 'get_answer':
        return ok(q.getAnswer(db, String(args['question_id'])));

      case 'list_activities': {
        const opts: q.ListActivitiesOpts = {};
        if (args['reporting_period_id'] !== undefined)
          opts.reporting_period_id = String(args['reporting_period_id']);
        if (args['year'] !== undefined) opts.year = Number(args['year']);
        return ok(q.listActivities(db, opts));
      }

      case 'list_emission_sources': {
        const opts: q.ListEmissionSourcesOpts = {};
        if (args['organization_id'] !== undefined)
          opts.organization_id = String(args['organization_id']);
        return ok(q.listEmissionSources(db, opts));
      }

      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
  } finally {
    rawDb.close();
  }
});

function ok(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

// ---------------------------------------------------------------------------
// Resources: inventory://{year} and questionnaire://{id}
// ---------------------------------------------------------------------------

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const rawDb = openAppDb();
  try {
    const db = rawDb as unknown as q.DbLike;
    const periods = db
      .prepare('SELECT DISTINCT year FROM reporting_period ORDER BY year DESC')
      .all() as Array<{ year: number }>;
    const questionnaires = q.listQuestionnaires(db);

    return {
      resources: [
        ...periods.map((p) => ({
          uri: `inventory://${p.year}`,
          name: `Inventory ${p.year}`,
          description: `Aggregated emissions totals for reporting year ${p.year}`,
          mimeType: 'application/json',
        })),
        ...questionnaires.map((qn) => ({
          uri: `questionnaire://${qn.id}`,
          name: `Questionnaire ${qn.customer_name} ${qn.reporting_year}`,
          description: `Full questionnaire detail for ${qn.customer_name} ${qn.reporting_year}`,
          mimeType: 'application/json',
        })),
      ],
    };
  } finally {
    rawDb.close();
  }
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri ?? '';
  const rawDb = openAppDb();
  try {
    const db = rawDb as unknown as q.DbLike;

    const inventoryMatch = /^inventory:\/\/(\d{4})$/.exec(uri);
    if (inventoryMatch) {
      const year = Number(inventoryMatch[1]);
      const totals = q.inventoryTotals(db, year);
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(totals, null, 2),
          },
        ],
      };
    }

    const questionnaireMatch = /^questionnaire:\/\/(.+)$/.exec(uri);
    if (questionnaireMatch) {
      const id = questionnaireMatch[1] ?? '';
      const detail = q.getQuestionnaire(db, id);
      if (!detail) throw new Error(`Questionnaire not found: ${id}`);
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(detail, null, 2),
          },
        ],
      };
    }

    throw new Error(`Unsupported resource URI: ${uri}`);
  } finally {
    rawDb.close();
  }
});

const transport = new StdioServerTransport();
(async () => {
  await server.connect(transport);
})();
