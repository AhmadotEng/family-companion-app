export type FamilyRelationshipType = "parent" | "spouse" | "sibling" | "guardian" | "relative";

export interface RelationshipResolverMember {
  id: string;
  displayName: string;
}

export interface RelationshipResolverEdge {
  sourceMemberId: string;
  targetMemberId: string;
  type: FamilyRelationshipType;
}

export interface EffectiveMemberRelationships {
  memberId: string;
  parentMemberIds: string[];
  spouseMemberIds: string[];
  siblingMemberIds: string[];
  childMemberIds: string[];
}

interface ProjectedRelationshipGraph {
  parentEdges: RelationshipResolverEdge[];
  spouseEdges: RelationshipResolverEdge[];
  siblingIds: Map<string, Set<string>>;
}

const directedPairKey = (sourceMemberId: string, targetMemberId: string) =>
  `${sourceMemberId}:${targetMemberId}`;

const symmetricPairKey = (leftMemberId: string, rightMemberId: string) =>
  leftMemberId < rightMemberId
    ? `${leftMemberId}:${rightMemberId}`
    : `${rightMemberId}:${leftMemberId}`;

function parentPathExists(
  parentEdges: RelationshipResolverEdge[],
  startMemberId: string,
  targetMemberId: string,
): boolean {
  const childrenByParent = new Map<string, string[]>();
  for (const edge of parentEdges) {
    childrenByParent.set(edge.sourceMemberId, [
      ...(childrenByParent.get(edge.sourceMemberId) ?? []),
      edge.targetMemberId,
    ]);
  }

  const visited = new Set<string>();
  const queue = [startMemberId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === targetMemberId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    queue.push(...(childrenByParent.get(current) ?? []));
  }
  return false;
}

/**
 * Builds the same safe read projection used by the Heritage Tree:
 * explicit siblings are full-sibling groups and share known parents, while
 * children who merely share one parent remain half-siblings and do not pass
 * their other parent across the pair. Guardian/relative links never become
 * biological parent links, and a spouse link never implies parenthood.
 */
function projectRelationshipGraph(
  members: RelationshipResolverMember[],
  relationships: RelationshipResolverEdge[],
): ProjectedRelationshipGraph {
  const orderedIds = members.map((member) => member.id);
  const memberIds = new Set(orderedIds);
  const memberOrder = new Map(orderedIds.map((id, index) => [id, index]));
  const compareIds = (left: string, right: string) =>
    (memberOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (memberOrder.get(right) ?? Number.MAX_SAFE_INTEGER) || left.localeCompare(right);
  const validEdges = relationships.filter(
    (edge) =>
      memberIds.has(edge.sourceMemberId) &&
      memberIds.has(edge.targetMemberId) &&
      edge.sourceMemberId !== edge.targetMemberId,
  );

  const unionParent = new Map(orderedIds.map((id) => [id, id]));
  const find = (id: string): string => {
    const current = unionParent.get(id) ?? id;
    if (current === id) return id;
    const root = find(current);
    unionParent.set(id, root);
    return root;
  };
  const union = (left: string, right: string) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) unionParent.set(rightRoot, leftRoot);
  };
  for (const edge of validEdges) {
    if (edge.type === "sibling") union(edge.sourceMemberId, edge.targetMemberId);
  }
  const explicitSiblingComponents = new Map<string, string[]>();
  for (const memberId of orderedIds) {
    const root = find(memberId);
    explicitSiblingComponents.set(root, [...(explicitSiblingComponents.get(root) ?? []), memberId]);
  }

  const parentEdgesByPair = new Map<string, RelationshipResolverEdge>();
  for (const edge of validEdges) {
    if (edge.type === "parent") {
      parentEdgesByPair.set(directedPairKey(edge.sourceMemberId, edge.targetMemberId), edge);
    }
  }

  const projectedParents: RelationshipResolverEdge[] = [];
  for (const componentMemberIds of explicitSiblingComponents.values()) {
    if (componentMemberIds.length < 2) continue;
    const component = new Set(componentMemberIds);
    const knownParents = new Set(
      [...parentEdgesByPair.values()]
        .filter((edge) => component.has(edge.targetMemberId) && !component.has(edge.sourceMemberId))
        .map((edge) => edge.sourceMemberId),
    );
    for (const parentMemberId of knownParents) {
      for (const childMemberId of componentMemberIds) {
        const key = directedPairKey(parentMemberId, childMemberId);
        if (parentMemberId !== childMemberId && !parentEdgesByPair.has(key)) {
          projectedParents.push({
            sourceMemberId: parentMemberId,
            targetMemberId: childMemberId,
            type: "parent",
          });
        }
      }
    }
  }
  projectedParents
    .sort(
      (left, right) =>
        compareIds(left.sourceMemberId, right.sourceMemberId) ||
        compareIds(left.targetMemberId, right.targetMemberId),
    )
    .forEach((edge) => {
      if (parentPathExists([...parentEdgesByPair.values()], edge.targetMemberId, edge.sourceMemberId)) return;
      parentEdgesByPair.set(directedPairKey(edge.sourceMemberId, edge.targetMemberId), edge);
    });

  const spouseEdgesByPair = new Map<string, RelationshipResolverEdge>();
  for (const edge of validEdges) {
    if (edge.type === "spouse") {
      spouseEdgesByPair.set(symmetricPairKey(edge.sourceMemberId, edge.targetMemberId), edge);
    }
  }

  // Exactly two effective co-parents are represented as spouses in the Tree
  // read model. This implication intentionally only runs parent -> spouse.
  const parentIdsByChild = new Map<string, Set<string>>();
  for (const edge of parentEdgesByPair.values()) {
    const parentIds = parentIdsByChild.get(edge.targetMemberId) ?? new Set<string>();
    parentIds.add(edge.sourceMemberId);
    parentIdsByChild.set(edge.targetMemberId, parentIds);
  }
  for (const parentIds of parentIdsByChild.values()) {
    if (parentIds.size !== 2) continue;
    const [firstParentId, secondParentId] = [...parentIds].sort(compareIds);
    const parentsAreExplicitSiblings =
      find(firstParentId) === find(secondParentId) &&
      (explicitSiblingComponents.get(find(firstParentId))?.length ?? 0) > 1;
    const parentsAreInOneLineage =
      parentPathExists([...parentEdgesByPair.values()], firstParentId, secondParentId) ||
      parentPathExists([...parentEdgesByPair.values()], secondParentId, firstParentId);
    if (parentsAreExplicitSiblings || parentsAreInOneLineage) continue;
    const key = symmetricPairKey(firstParentId, secondParentId);
    if (!spouseEdgesByPair.has(key)) {
      spouseEdgesByPair.set(key, {
        sourceMemberId: firstParentId,
        targetMemberId: secondParentId,
        type: "spouse",
      });
    }
  }

  const siblingIds = new Map(orderedIds.map((id) => [id, new Set<string>()]));
  const addSiblingPair = (left: string, right: string) => {
    if (left === right) return;
    siblingIds.get(left)?.add(right);
    siblingIds.get(right)?.add(left);
  };
  for (const componentMemberIds of explicitSiblingComponents.values()) {
    componentMemberIds.forEach((memberId, index) => {
      componentMemberIds.slice(index + 1).forEach((siblingId) => addSiblingPair(memberId, siblingId));
    });
  }
  const childrenByParent = new Map<string, Set<string>>();
  for (const edge of parentEdgesByPair.values()) {
    const children = childrenByParent.get(edge.sourceMemberId) ?? new Set<string>();
    children.add(edge.targetMemberId);
    childrenByParent.set(edge.sourceMemberId, children);
  }
  for (const children of childrenByParent.values()) {
    const childIds = [...children].sort(compareIds);
    childIds.forEach((childId, index) => {
      childIds.slice(index + 1).forEach((siblingId) => addSiblingPair(childId, siblingId));
    });
  }

  const compareEdges = (left: RelationshipResolverEdge, right: RelationshipResolverEdge) =>
    compareIds(left.sourceMemberId, right.sourceMemberId) ||
    compareIds(left.targetMemberId, right.targetMemberId) ||
    left.type.localeCompare(right.type);
  return {
    parentEdges: [...parentEdgesByPair.values()].sort(compareEdges),
    spouseEdges: [...spouseEdgesByPair.values()].sort(compareEdges),
    siblingIds,
  };
}

export function buildEffectiveFamilyRelationships(
  members: RelationshipResolverMember[],
  relationships: RelationshipResolverEdge[],
): EffectiveMemberRelationships[] {
  const graph = projectRelationshipGraph(members, relationships);
  const memberOrder = new Map(members.map((member, index) => [member.id, index]));
  const compareIds = (left: string, right: string) =>
    (memberOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (memberOrder.get(right) ?? Number.MAX_SAFE_INTEGER) || left.localeCompare(right);

  return members.map((member) => ({
    memberId: member.id,
    parentMemberIds: graph.parentEdges
      .filter((edge) => edge.targetMemberId === member.id)
      .map((edge) => edge.sourceMemberId)
      .sort(compareIds),
    spouseMemberIds: graph.spouseEdges
      .filter((edge) => edge.sourceMemberId === member.id || edge.targetMemberId === member.id)
      .map((edge) => (edge.sourceMemberId === member.id ? edge.targetMemberId : edge.sourceMemberId))
      .sort(compareIds),
    siblingMemberIds: [...(graph.siblingIds.get(member.id) ?? [])].sort(compareIds),
    childMemberIds: graph.parentEdges
      .filter((edge) => edge.sourceMemberId === member.id)
      .map((edge) => edge.targetMemberId)
      .sort(compareIds),
  }));
}

export interface GatheringInviteeResolutionInput {
  request: string;
  history: Array<{ role: "user" | "assistant"; message: string }>;
  members: RelationshipResolverMember[];
  effectiveRelationships: EffectiveMemberRelationships[];
  requesterMemberId: string | null;
  providerMemberIds: string[];
}

export interface GatheringInviteeResolution {
  memberIds: string[];
  referenceText: string;
  requesterExplicitlyIncluded: boolean;
  /** True only when deterministic request text identifies invitee intent. */
  inviteesRequested?: boolean;
  clarification?: string;
  invalidMemberIds?: string[];
}

const normalizeWords = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

// Keep typo handling intentionally narrow. These aliases are normalized only
// for relationship intent; they never alter stored names or transcript text.
const normalizeInviteeRelationshipAliases = (value: string, knownNames: Set<string>) => {
  if (knownNames.has("siplinng")) return value;
  return value.replace(/\b(my|and|the)\s+siplinng\b/giu, "$1 sibling");
};

const containsPhrase = (normalizedText: string, normalizedPhrase: string) =>
  ` ${normalizedText} `.includes(` ${normalizedPhrase} `);

const gatheringSeedPattern =
  /\b(?:plan|organize|schedule|gathering|get[ -]together|outing|activity|visit|meet|go\s+to|come\s+to|dinner|lunch|breakfast|tea|coffee|picnic|park)\b/i;
const gatheringContinuationPattern = /\b(?:invite|inviting|include|including|with)\b/i;
export const isPlannerClarificationMessage = (message: string) =>
  /(?:what date|dubai time|am or pm|where would|which .*do you mean|which family member|which other family member|couldn'?t match|couldn'?t safely match)/i.test(
    message,
  );

interface GatheringReferenceWindow {
  referenceText: string;
  historyStartIndex: number;
}

function gatheringReferenceWindow(
  request: string,
  history: Array<{ role: "user" | "assistant"; message: string }>,
): GatheringReferenceWindow {
  const lastTurn = history.at(-1);
  const followsPlannerClarification =
    lastTurn?.role === "assistant" && isPlannerClarificationMessage(lastTurn.message);
  const explicitlyReplacesPendingPlan =
    followsPlannerClarification &&
    (
      /\b(?:forget\s+(?:that|it)|new\s+plan|different\s+(?:plan|gathering))\b/i.test(request) ||
      /\b(?:actually|instead)\b[^.!?]*\b(?:plan|organize|schedule)\b/i.test(request)
    );
  if (gatheringSeedPattern.test(request) && (!followsPlannerClarification || explicitlyReplacesPendingPlan)) {
    return { referenceText: request, historyStartIndex: history.length };
  }
  if (followsPlannerClarification) {
    let startIndex = history.length - 1;
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const turn = history[index];
      if (turn.role === "assistant" && !isPlannerClarificationMessage(turn.message)) {
        startIndex = index + 1;
        break;
      }
      startIndex = index;
    }
    return {
      referenceText: [
        ...history.slice(startIndex).filter((turn) => turn.role === "user").map((turn) => turn.message),
        request,
      ].join("\n"),
      historyStartIndex: startIndex,
    };
  }
  let seedIndex = -1;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index];
    if (turn.role === "user" && gatheringSeedPattern.test(turn.message)) {
      seedIndex = index;
      break;
    }
  }
  if (seedIndex >= 0) {
    return {
      referenceText: [
        ...history.slice(seedIndex).filter((turn) => turn.role === "user").map((turn) => turn.message),
        request,
      ].join("\n"),
      historyStartIndex: seedIndex,
    };
  }
  if (gatheringContinuationPattern.test(request)) {
    for (let index = history.length - 1; index >= 0; index -= 1) {
      if (history[index].role === "user") {
        return {
          referenceText: `${history[index].message}\n${request}`,
          historyStartIndex: index,
        };
      }
    }
  }
  return { referenceText: request, historyStartIndex: history.length };
}

export function gatheringReferenceText(
  request: string,
  history: Array<{ role: "user" | "assistant"; message: string }>,
): string {
  return gatheringReferenceWindow(request, history).referenceText;
}

const genericInviteePhrases = new Set([
  "family",
  "my family",
  "parent",
  "parents",
  "my parent",
  "my parents",
  "my mother",
  "my mom",
  "my mama",
  "my father",
  "my dad",
  "my dada",
  "sibling",
  "siblings",
  "my sibling",
  "my siblings",
  "brother",
  "brothers",
  "sister",
  "sisters",
  "spouse",
  "my spouse",
  "wife",
  "my wife",
  "husband",
  "my husband",
  "child",
  "children",
  "kid",
  "kids",
  "son",
  "daughter",
  "my child",
  "my children",
  "my kids",
  "everyone",
  "everybody",
  "them",
  "us",
  "me",
  "myself",
  "no one else",
  "nobody else",
]);

const nameTokenStopWords = new Set([
  "family",
  "gathering",
  "planner",
  "owner",
  "member",
  "parent",
  "parents",
  "sibling",
  "siblings",
  "brother",
  "sister",
  "spouse",
  "wife",
  "husband",
  "child",
  "children",
  "son",
  "daughter",
]);

function inviteeClauses(referenceText: string, knownNames: Set<string>): string[] {
  const definiteSegments: string[] = [];
  const conditionalSegments: string[] = [];
  const collect = (matcher: RegExp, destination: string[]) => {
    for (const match of referenceText.matchAll(matcher)) {
      if (match[1]) destination.push(match[1]);
    }
  };

  collect(/\b(?:with|invite|inviting|include|including)\s+([^.!?;]+)/giu, definiteSegments);
  collect(/\b(?:no\s+one|nobody)\s+except\s+([^.!?;]+)/giu, conditionalSegments);
  collect(
    /\b(?:plan(?:ning)?(?:\s+(?:a|the))?(?:\s+(?:visit|gathering|outing|meal|dinner|lunch|breakfast|picnic))?|visit|gathering|outing|meal|dinner|lunch|breakfast|picnic)\s+for\s+([^.!?;]+)/giu,
    conditionalSegments,
  );
  collect(/\btake\s+([^.!?;]+?)\s+to\s+[^.!?;]+/giu, conditionalSegments);
  collect(/\bbring\s+([^.!?;]+)/giu, conditionalSegments);
  collect(/\bmeet\s+([^.!?;]+)/giu, conditionalSegments);

  const looksLikeInvitee = (rawValue: string, normalizedValue: string) => {
    if (
      /^(?:(?:my|our|the)\s+)?(?:birthday|anniversary|celebration|fun|family\s+bonding|bonding|quality\s+time|dinner|lunch|breakfast)\b/i.test(
        rawValue,
      ) ||
      /^(?:next|this|coming|today|tomorrow|tonight)\b/i.test(rawValue) ||
      /^\d+\s+(?:people|persons?|guests?|attendees?)\b/i.test(rawValue)
    ) {
      return false;
    }
    if ([...knownNames].some((name) => containsPhrase(normalizedValue, name))) return true;
    if (
      /^(?:my\s+)?(?:family|parents?|mothers?|moms?|mamas?|fathers?|dads?|dadas?|siblings?|brothers?|sisters?|spouses?|wives|husbands?|children|kids?|sons?|daughters?|cousins?|aunts?|uncles?|grandmothers?|grandmas?|grandfathers?|grandpas?|everyone|everybody|them|us|me|myself|someone|somebody|friends?|guests?)\b/i.test(
        normalizedValue,
      )
    ) {
      return true;
    }
    return /^\p{Lu}[\p{L}'’-]*(?:\s+\p{Lu}[\p{L}'’-]*)*$/u.test(rawValue.trim());
  };

  const clauses: string[] = [];
  const isNonInviteeDetail = (value: string) =>
    /^(?:(?:a|an|the)\s+)?(?:budget(?:\s+of)?|cost(?:s|ing)?|transport(?:ation)?|ride|carpool|taxi|car|bus|metro|picnic\s+blanket|blanket|folding\s+chairs?|chairs?|equipment|sunscreen|sunblock|rain(?:s|ing)?|rain\s+backup(?:\s+plan)?|weather|weather\s+backup(?:\s+plan)?|indoor(?:\s+(?:area|backup))?|use\s+(?:the\s+)?indoor(?:\s+area)?|umbrella)\b/iu.test(value.trim()) ||
    /^(?:(?:a|an|the)\s+)?(?:wheelchair|accessibility|accessible|dietary|allerg(?:y|ies|ic)|medicine|medication|parking|step[- ]free|halal|kosher|vegan|vegetarian|pescatarian|gluten[- ]free|dairy[- ]free|lactose[- ]free|nut[- ]free|peanut[- ]free|sugar[- ]free|food\b|no\s+\p{L}[\p{L}\p{N}'’-]*)\b/iu.test(
      value.trim(),
    );
  for (const [segments, conditional] of [
    [definiteSegments, false],
    [conditionalSegments, true],
  ] as const) {
    for (const segment of segments) {
    const bounded = segment
      .split(
        /\s+(?:(?:to|for)\s+(?=\p{L})|on\s+(?=\p{L}|\d)|at\s+(?=\p{L}|\d)|(?=(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}\b)|(?=\d{1,2}(?:st|nd|rd|th)?(?:\s+of)?\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b)|(?=\d{4}-\d{1,2}-\d{1,2}\b)|(?=\d{1,2}[/.]\d{1,2}(?:[/.]\d{4})?\b)|tomorrow\b|next\s+\p{L}+\b)/iu,
        1,
      )[0]
      .trim();
      for (const rawPart of bounded.split(/\s*(?:,|\band\b|&)\s*/iu)) {
        // "with" can introduce accessibility or dietary details as well as
        // people. Keep those details available for note grounding without
        // turning them into an unknown family-member clarification.
        if (isNonInviteeDetail(rawPart)) continue;
        const normalizedPart = normalizeWords(rawPart);
        if (!normalizedPart || (conditional && !looksLikeInvitee(rawPart, normalizedPart))) continue;
        clauses.push(normalizedPart);
      }
    }
  }
  return clauses;
}

function formatMemberChoices(memberIds: string[], membersById: Map<string, RelationshipResolverMember>): string {
  const names = memberIds.map((id) => membersById.get(id)?.displayName).filter((name): name is string => Boolean(name));
  const shownNames = names.slice(0, 5);
  const formatted = new Intl.ListFormat("en", { style: "long", type: "disjunction" }).format(shownNames);
  const remaining = names.length - shownNames.length;
  return remaining > 0 ? `${formatted}, or ${remaining} more` : formatted;
}

const clarificationPhrase = (value: string) => (value.length > 120 ? `${value.slice(0, 117)}...` : value);

function explicitlyRequestsNoInvitees(referenceText: string): boolean {
  if (/\b(?:no\s+one|nobody)\s+except\b/i.test(referenceText)) return false;
  if (/\b(?:and|but)\s+(?:no\s+one|nobody)\s+else\b/i.test(referenceText)) return false;
  if (
    /\b(?:with|invite|inviting|include|including|bring)\s+(?!no\s+one\b|nobody\b)[^.!?;]*\b(?:no\s+one|nobody)\s+else\b/i.test(
      referenceText,
    )
  ) {
    return false;
  }
  return /\b(?:alone|solo|by\s+myself|just\s+me|no\s+one|nobody)\b/i.test(referenceText);
}

/** Resolve invitees independently of provider-selected IDs. */
export function resolveGatheringInvitees(input: GatheringInviteeResolutionInput): GatheringInviteeResolution {
  const referenceWindow = gatheringReferenceWindow(input.request, input.history);
  const { referenceText } = referenceWindow;
  const membersById = new Map(input.members.map((member) => [member.id, member]));
  const validIds = new Set(membersById.keys());
  const invalidMemberIds = [...new Set(input.providerMemberIds.filter((memberId) => !validIds.has(memberId)))];
  if (invalidMemberIds.length > 0) {
    return {
      memberIds: [],
      referenceText,
      requesterExplicitlyIncluded: false,
      invalidMemberIds,
    };
  }

  const fullNameIndex = new Map<string, string[]>();
  const shortNameIndex = new Map<string, string[]>();
  for (const member of input.members) {
    const fullName = normalizeWords(member.displayName);
    if (!fullName) continue;
    fullNameIndex.set(fullName, [...(fullNameIndex.get(fullName) ?? []), member.id]);
    for (const token of new Set(fullName.split(" "))) {
      if (token.length < 2 || nameTokenStopWords.has(token)) continue;
      shortNameIndex.set(token, [...(shortNameIndex.get(token) ?? []), member.id]);
    }
  }

  const knownNames = new Set(fullNameIndex.keys());
  const inviteeReplacementCue = /\b(?:actually|instead|rather\s+than|replace|switch|change|only)\b/i;
  const hasRecognizedInviteeReference = (turn: string): boolean => {
    const normalizedRelationshipTurn = normalizeInviteeRelationshipAliases(turn, knownNames);
    const clauses = inviteeClauses(normalizedRelationshipTurn, knownNames);
    const relationshipOrSelf = /^(?:my\s+)?(?:parents?|mothers?|moms?|mamas?|fathers?|dads?|dadas?|siblings?|brothers?|sisters?|spouses?|wives|husbands?|children|kids?|sons?|daughters?|me|myself)$/i;
    if (
      clauses.some((clause) => {
        if (/^(?:no\s+one|nobody)(?:\s+else)?$/i.test(clause)) return false;
        if (genericInviteePhrases.has(clause) || relationshipOrSelf.test(clause)) return true;
        return [...knownNames].some((name) => containsPhrase(clause, name));
      })
    ) {
      return true;
    }
    if (!inviteeReplacementCue.test(normalizedRelationshipTurn)) return false;
    const normalizedTurn = normalizeWords(normalizedRelationshipTurn);
    return (
      [...knownNames].some((name) => containsPhrase(normalizedTurn, name)) ||
      /\b(?:my\s+)?(?:parents?|mothers?|moms?|mamas?|fathers?|dads?|dadas?|siblings?|brothers?|sisters?|spouses?|wives|husbands?|children|kids?|sons?|daughters?)\b/i.test(
        normalizedTurn,
      )
    );
  };
  const relevantUserTurns = [
    ...input.history
      .slice(referenceWindow.historyStartIndex)
      .map((turn, offset) => ({ ...turn, historyIndex: referenceWindow.historyStartIndex + offset }))
      .filter((turn) => turn.role === "user")
      .map((turn) => ({ message: turn.message, historyIndex: turn.historyIndex })),
    { message: input.request, historyIndex: input.history.length },
  ];
  let inviteeStartIndex = 0;
  let latestSelectionWasNoInvitees = false;
  for (let index = 0; index < relevantUserTurns.length; index += 1) {
    const turn = relevantUserTurns[index].message;
    const hasInvitee = hasRecognizedInviteeReference(turn);
    // An explicit person wins over contradictory prose in the same turn:
    // "alone with Dad" still names Dad, while a bare "alone" clears invitees.
    const hasNoInvitees = explicitlyRequestsNoInvitees(turn) && !hasInvitee;
    if (hasNoInvitees) {
      inviteeStartIndex = index;
      latestSelectionWasNoInvitees = true;
      continue;
    }
    if (hasInvitee && (latestSelectionWasNoInvitees || inviteeReplacementCue.test(turn))) {
      inviteeStartIndex = index;
    }
    if (hasInvitee) latestSelectionWasNoInvitees = false;
  }
  const inviteeReferenceText = relevantUserTurns
    .slice(inviteeStartIndex)
    .map((turn) => normalizeInviteeRelationshipAliases(turn.message, knownNames))
    .join("\n");
  const inviteeHistoryStartIndex = relevantUserTurns[inviteeStartIndex]?.historyIndex ?? referenceWindow.historyStartIndex;
  if (
    explicitlyRequestsNoInvitees(inviteeReferenceText) &&
    !hasRecognizedInviteeReference(inviteeReferenceText)
  ) {
    return {
      memberIds: [],
      referenceText,
      requesterExplicitlyIncluded: false,
    };
  }

  const longestContainedNames = (value: string): Array<[string, string[]]> => {
    const matches = [...fullNameIndex.entries()]
      .filter(([name]) => containsPhrase(value, name))
      .sort((left, right) => right[0].length - left[0].length);
    const selected: Array<[string, string[]]> = [];
    for (const match of matches) {
      if (selected.some(([longerName]) => containsPhrase(longerName, match[0]))) continue;
      selected.push(match);
    }
    return selected;
  };

  const explicitlyExcludedIds = new Set<string>();
  for (const match of inviteeReferenceText.matchAll(/\b(not|except|excluding|without)\s+([^\n.!?;,]+)/giu)) {
    const operator = match[1].toLocaleLowerCase("en");
    const prefix = inviteeReferenceText.slice(Math.max(0, (match.index ?? 0) - 20), match.index).trimEnd();
    if (operator === "except" && /\b(?:no\s+one|nobody)\s*$/i.test(prefix)) continue;
    const bounded = normalizeWords(
      match[2].split(/\s+(?:on|at|to|for)\s+(?=\p{L}|\d)/iu, 1)[0],
    );
    for (const [, memberIds] of longestContainedNames(bounded)) {
      memberIds.forEach((memberId) => explicitlyExcludedIds.add(memberId));
    }
    const direct = fullNameIndex.get(bounded) ?? shortNameIndex.get(bounded);
    direct?.forEach((memberId) => explicitlyExcludedIds.add(memberId));
  }

  const explicitlyNamedIds = new Set<string>();
  type SelectionCategory = "parent" | "sibling" | "spouse" | "child" | "general";
  const promptCategory = (message: string): SelectionCategory | undefined => {
    const normalized = normalizeWords(message);
    const isSelectionPrompt =
      normalized.includes("which") &&
      /\b(?:mean|profile|member|parent|sibling|spouse|child)\b/.test(normalized);
    if (!isSelectionPrompt) return undefined;
    if (/\bparent/.test(normalized)) return "parent";
    if (/\bsibling/.test(normalized)) return "sibling";
    if (/\bspouse/.test(normalized)) return "spouse";
    if (/\bchild/.test(normalized)) return "child";
    return "general";
  };
  const selectedIdsFromAnswer = (answer: string): string[] => {
    const selected = new Set<string>();
    const normalizedAnswer = normalizeWords(answer);
    const parts = normalizedAnswer.split(/\s*(?:,|\band\b|&)\s*/u).filter(Boolean);
    for (const part of parts) {
      const withoutPossessive = part.replace(/^my\s+/, "");
      const exact = fullNameIndex.get(part) ?? fullNameIndex.get(withoutPossessive) ?? shortNameIndex.get(part);
      if (exact?.length === 1) {
        selected.add(exact[0]);
        continue;
      }
      const contained = longestContainedNames(part)
        .flatMap(([, memberIds]) => (memberIds.length === 1 ? memberIds : []));
      contained.forEach((memberId) => selected.add(memberId));
    }
    return [...selected];
  };

  // Derive durable clarification state from the transcript. A name supplied
  // directly after a deterministic "which member?" prompt remains selected
  // through later date/time questions without storing hidden model state.
  const selectionsByCategory = new Map<SelectionCategory, Set<string>>();
  const correctionCountByCategory = new Map<SelectionCategory, number>();
  const rememberSelection = (category: SelectionCategory, selectedIds: string[]) => {
    if (selectedIds.length === 0) return;
    const accumulated = selectionsByCategory.get(category) ?? new Set<string>();
    selectedIds.forEach((memberId) => accumulated.add(memberId));
    selectionsByCategory.set(category, accumulated);
    correctionCountByCategory.set(category, (correctionCountByCategory.get(category) ?? 0) + 1);
  };
  let pendingCategory: SelectionCategory | undefined;
  const relevantHistory = input.history.slice(
    Math.max(referenceWindow.historyStartIndex, inviteeHistoryStartIndex),
  );
  for (const turn of relevantHistory) {
    if (turn.role === "assistant") {
      pendingCategory = promptCategory(turn.message);
      continue;
    }
    if (pendingCategory) {
      rememberSelection(pendingCategory, selectedIdsFromAnswer(turn.message));
    }
    pendingCategory = undefined;
  }
  if (pendingCategory) {
    rememberSelection(pendingCategory, selectedIdsFromAnswer(input.request));
  }
  selectionsByCategory.get("general")?.forEach((memberId) => explicitlyNamedIds.add(memberId));

  const ambiguities: Array<{ phrase: string; memberIds: string[] }> = [];
  const replacementClauses = inviteeReferenceText
    .split("\n")
    .filter((turn) => inviteeReplacementCue.test(turn))
    .flatMap((turn) => {
      const normalizedTurn = normalizeWords(turn);
      const names = [...knownNames].filter((name) => containsPhrase(normalizedTurn, name));
      const relationships = normalizedTurn.match(
        /\b(?:my\s+)?(?:parents?|mothers?|moms?|mamas?|fathers?|dads?|dadas?|siblings?|brothers?|sisters?|spouses?|wives|husbands?|children|kids?|sons?|daughters?)\b/giu,
      ) ?? [];
      return [...names, ...relationships];
    });
  const clauses = [...new Set([...inviteeClauses(inviteeReferenceText, knownNames), ...replacementClauses])];
  const unknownNames: string[] = [];
  for (const clause of clauses) {
    const withoutPossessive = clause.replace(/^my\s+/, "");
    const exactMatches = (fullNameIndex.get(clause) ?? fullNameIndex.get(withoutPossessive))?.filter(
      (memberId) => !explicitlyExcludedIds.has(memberId),
    );
    if (exactMatches) {
      if (exactMatches.length === 0) continue;
      if (exactMatches.length === 1) explicitlyNamedIds.add(exactMatches[0]);
      else ambiguities.push({ phrase: clause, memberIds: exactMatches });
      continue;
    }
    if (
      genericInviteePhrases.has(clause) ||
      /^(?:my\s+)?(?:parents?|mothers?|moms?|mamas?|fathers?|dads?|dadas?|siblings?|brothers?|sisters?|spouses?|wives|husbands?|children|kids?|sons?|daughters?)$/.test(
        clause,
      )
    ) {
      continue;
    }
    const shortMatches = shortNameIndex.get(clause)?.filter((memberId) => !explicitlyExcludedIds.has(memberId));
    if (shortMatches) {
      if (shortMatches.length === 0) continue;
      if (shortMatches.length === 1) explicitlyNamedIds.add(shortMatches[0]);
      else ambiguities.push({ phrase: clause, memberIds: shortMatches });
      continue;
    }
    // A clause can contain a clearly unique full name plus harmless words such
    // as "my cousin". Resolve all contained full names before declaring it unknown.
    const contained = longestContainedNames(clause);
    if (contained.length > 0) {
      for (const [name, memberIds] of contained) {
        const includedMemberIds = memberIds.filter((memberId) => !explicitlyExcludedIds.has(memberId));
        if (includedMemberIds.length === 1) explicitlyNamedIds.add(includedMemberIds[0]);
        else if (includedMemberIds.length > 1) ambiguities.push({ phrase: name, memberIds: includedMemberIds });
      }
      continue;
    }
    unknownNames.push(clause);
  }

  // A general name correction answers the first outstanding explicit-name
  // issue. Relation-specific selections are handled independently below.
  let generalCorrections = correctionCountByCategory.get("general") ?? 0;
  while (generalCorrections > 0 && ambiguities.length > 0) {
    ambiguities.shift();
    generalCorrections -= 1;
  }
  while (generalCorrections > 0 && unknownNames.length > 0) {
    unknownNames.shift();
    generalCorrections -= 1;
  }

  if (ambiguities.length > 0) {
    const ambiguity = ambiguities[0];
    const choices = formatMemberChoices(ambiguity.memberIds, membersById);
    const phrase = clarificationPhrase(ambiguity.phrase);
    return {
      memberIds: [],
      referenceText,
      requesterExplicitlyIncluded: false,
      clarification: choices
        ? `Which ${phrase} do you mean? I found multiple matching family profiles: ${choices}.`
        : `Which ${phrase} do you mean? I found multiple matching family profiles.`,
    };
  }
  if (unknownNames.length > 0) {
    const phrase = clarificationPhrase(unknownNames[0]);
    return {
      memberIds: [],
      referenceText,
      requesterExplicitlyIncluded: false,
      clarification: `I couldn't match “${phrase}” to a visible family profile. Which family member do you mean?`,
    };
  }

  const effective = input.effectiveRelationships.find(
    (relationships) => relationships.memberId === input.requesterMemberId,
  );
  const requestedIds = new Set(explicitlyNamedIds);
  let hasDeterministicReference = explicitlyNamedIds.size > 0;

  const singularResolution = (
    label: string,
    ids: string[],
    selectedByName: Set<string>,
    requestedCount = 1,
  ): string | undefined => {
    hasDeterministicReference = true;
    const namedMatches = ids.filter((id) => selectedByName.has(id));
    if (ids.length === requestedCount) {
      ids.forEach((id) => requestedIds.add(id));
      return undefined;
    }
    if (namedMatches.length === requestedCount) {
      namedMatches.forEach((id) => requestedIds.add(id));
      return undefined;
    }
    if (ids.length === 0) {
      return `I couldn't find a visible ${label} in your family tree. Which family member do you mean?`;
    }
    const remainingIds = ids.filter((id) => !namedMatches.includes(id));
    if (requestedCount > 1 && namedMatches.length > 0) {
      return `Which other ${label} do you mean: ${formatMemberChoices(remainingIds, membersById)}?`;
    }
    const promptLabel = requestedCount > 1 ? `${label}s` : label;
    return `Which ${promptLabel} do you mean: ${formatMemberChoices(ids, membersById)}?`;
  };
  const pluralResolution = (
    label: string,
    ids: string[],
    minimum = 1,
    selectedByName: Set<string> = new Set<string>(),
  ): string | undefined => {
    hasDeterministicReference = true;
    const supplementalIds = [...selectedByName].filter(
      (memberId) => memberId !== input.requesterMemberId && !ids.includes(memberId),
    );
    if (ids.length + supplementalIds.length < minimum) {
      return minimum === 2 && ids.length === 1
        ? `I can only find one visible ${label.slice(0, -1)} in your family tree. Which other family member did you mean?`
        : `I couldn't find visible ${label} in your family tree. Which family members do you mean?`;
    }
    ids.forEach((id) => requestedIds.add(id));
    supplementalIds.forEach((id) => requestedIds.add(id));
    return undefined;
  };

  // Natural lists often elide the second possessive: "my parents and sibling".
  const possessiveOrConjunction = "(?:my|and)";
  const relationshipReferenceText = inviteeReferenceText.replace(
    /\b(?:not|excluding|without)\s+(?:my\s+)?(?:parents?|mothers?|moms?|mamas?|fathers?|dads?|dadas?|siblings?|brothers?|sisters?|spouses?|wives|husbands?|children|kids?|sons?|daughters?)\b/giu,
    "",
  );
  const parentsPlural = new RegExp(
    `\\b${possessiveOrConjunction}\\s+(?:parents|mothers|moms|mamas|fathers|dads|dadas)\\b`,
    "i",
  ).test(
    relationshipReferenceText,
  );
  const parentSingularPattern = new RegExp(
    `\\b${possessiveOrConjunction}\\s+(?:parent|mother|mom|mama|father|dad|dada)\\b(?!s)`,
    "gi",
  );
  const parentSingularCount = [...relationshipReferenceText.matchAll(parentSingularPattern)].length;
  const parentSingular = parentSingularCount > 0;
  const siblingsPlural = new RegExp(
    `\\b${possessiveOrConjunction}\\s+(?:siblings|brothers|sisters)\\b`,
    "i",
  ).test(relationshipReferenceText);
  const siblingSingularPattern = new RegExp(
    `\\b${possessiveOrConjunction}\\s+(?:sibling|brother|sister)\\b(?!s)`,
    "gi",
  );
  const siblingSingularCount = [...relationshipReferenceText.matchAll(siblingSingularPattern)].length;
  const siblingSingular = siblingSingularCount > 0;
  const spousesPlural = new RegExp(
    `\\b${possessiveOrConjunction}\\s+(?:spouses|wives|husbands)\\b`,
    "i",
  ).test(
    relationshipReferenceText,
  );
  const spouseSingularPattern = new RegExp(
    `\\b${possessiveOrConjunction}\\s+(?:spouse|wife|husband)\\b`,
    "gi",
  );
  const spouseSingularCount = [...relationshipReferenceText.matchAll(spouseSingularPattern)].length;
  const spouseSingular = spouseSingularCount > 0;
  const childrenPlural = new RegExp(
    `\\b${possessiveOrConjunction}\\s+(?:children|kids|sons|daughters)\\b`,
    "i",
  ).test(relationshipReferenceText);
  const childSingularPattern = new RegExp(
    `\\b${possessiveOrConjunction}\\s+(?:child|kid|son|daughter)\\b(?!s)`,
    "gi",
  );
  const childSingularCount = [...relationshipReferenceText.matchAll(childSingularPattern)].length;
  const childSingular = childSingularCount > 0;
  const needsRelationshipResolution =
    parentsPlural ||
    parentSingular ||
    siblingsPlural ||
    siblingSingular ||
    spousesPlural ||
    spouseSingular ||
    childrenPlural ||
    childSingular;

  if (needsRelationshipResolution && !input.requesterMemberId) {
    return {
      memberIds: [],
      referenceText,
      requesterExplicitlyIncluded: false,
      clarification: "Link your account to your family profile before I resolve relatives for this gathering.",
    };
  }
  if (needsRelationshipResolution && !effective) {
    return {
      memberIds: [],
      referenceText,
      requesterExplicitlyIncluded: false,
      clarification: "I couldn't resolve relatives from your visible family tree. Which family members do you mean?",
    };
  }

  const relationSelections = (category: Exclude<SelectionCategory, "general">) =>
    selectionsByCategory.get(category) ?? new Set<string>();
  const singularSelections = (category: Exclude<SelectionCategory, "general">) =>
    new Set([...explicitlyNamedIds, ...relationSelections(category)]);

  const clarifications = [
    parentsPlural
      ? pluralResolution("parents", effective?.parentMemberIds ?? [], 2, relationSelections("parent"))
      : undefined,
    parentSingular
      ? singularResolution("parent", effective?.parentMemberIds ?? [], singularSelections("parent"), parentSingularCount)
      : undefined,
    siblingsPlural
      ? pluralResolution("siblings", effective?.siblingMemberIds ?? [], 1, relationSelections("sibling"))
      : undefined,
    siblingSingular
      ? singularResolution(
          "sibling",
          effective?.siblingMemberIds ?? [],
          singularSelections("sibling"),
          siblingSingularCount,
        )
      : undefined,
    spousesPlural
      ? pluralResolution("spouses", effective?.spouseMemberIds ?? [], 1, relationSelections("spouse"))
      : undefined,
    spouseSingular
      ? singularResolution("spouse", effective?.spouseMemberIds ?? [], singularSelections("spouse"), spouseSingularCount)
      : undefined,
    childrenPlural
      ? pluralResolution("children", effective?.childMemberIds ?? [], 1, relationSelections("child"))
      : undefined,
    childSingular
      ? singularResolution("child", effective?.childMemberIds ?? [], singularSelections("child"), childSingularCount)
      : undefined,
  ].filter((value): value is string => Boolean(value));
  if (clarifications.length > 0) {
    return {
      memberIds: [],
      referenceText,
      requesterExplicitlyIncluded: false,
      clarification: clarifications[0],
    };
  }

  const requesterExplicitlyIncluded =
    /\b(?:include|invite|add)\s+(?:me|myself)\b|\bwith\s+me\b|\band\s+me\b|\bmyself\b/i.test(inviteeReferenceText) ||
    (input.requesterMemberId !== null && explicitlyNamedIds.has(input.requesterMemberId));
  if (requesterExplicitlyIncluded && input.requesterMemberId) {
    requestedIds.add(input.requesterMemberId);
    hasDeterministicReference = true;
  }
  const hasInviteeLanguage =
    clauses.length > 0 ||
    needsRelationshipResolution ||
    /\b(?:invite|inviting|include|including)\b/i.test(inviteeReferenceText) ||
    requesterExplicitlyIncluded;
  if (!hasDeterministicReference && hasInviteeLanguage) {
    return {
      memberIds: [],
      referenceText,
      requesterExplicitlyIncluded,
      clarification: "Which visible family members would you like to invite?",
    };
  }

  // Provider-selected IDs are never the source of truth. The server derives
  // invitees only from names, relationships, and explicit self-inclusion in
  // the user's active gathering request.
  const sourceIds = [...requestedIds];
  return {
    memberIds: sourceIds.filter(
      (memberId) =>
        !explicitlyExcludedIds.has(memberId) &&
        (memberId !== input.requesterMemberId || requesterExplicitlyIncluded),
    ),
    referenceText,
    requesterExplicitlyIncluded,
    inviteesRequested: hasInviteeLanguage,
  };
}
